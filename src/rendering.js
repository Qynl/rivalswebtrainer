import * as THREE from "three";

// One depth-aware finishing pass: local ambient occlusion, gentle sharpening,
// and a very restrained grade. Weapon/HUD are drawn afterwards, so neither is blurred.
export class ArenaRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.target.samples = 2;
    this.target.depthTexture = new THREE.DepthTexture(
      1,
      1,
      THREE.UnsignedIntType,
    );
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        colorMap: { value: this.target.texture },
        depthMap: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        inverseProjection: { value: new THREE.Matrix4() },
        projectionScale: { value: 1 },
        aoStrength: { value: 1.05 },
      },
      vertexShader: `varying vec2 screenUv;void main(){screenUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `
        varying vec2 screenUv;
        uniform sampler2D colorMap,depthMap;
        uniform vec2 resolution;
        uniform mat4 inverseProjection;
        uniform float projectionScale,aoStrength;
        vec3 positionAt(vec2 uv){float d=texture2D(depthMap,uv).x;vec4 p=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
        void main(){
          vec3 color=texture2D(colorMap,screenUv).rgb;
          float depth=texture2D(depthMap,screenUv).r;
          if(depth<.99998){
            vec3 p=positionAt(screenUv);
            vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
            float radius=.8;
            float pixels=clamp(radius*projectionScale*resolution.y/max(.2,-p.z)*.5,2.,28.);
            float occlusion=0.;
            for(int i=0;i<12;i++){
              float f=float(i)+.5,angle=f*2.39996323;
              vec2 offset=vec2(cos(angle),sin(angle))*sqrt(f/12.)*pixels/resolution;
              vec2 uv=clamp(screenUv+offset,vec2(.001),vec2(.999));
              vec3 delta=positionAt(uv)-p;float dist=length(delta);
              float horizon=max(dot(normal,delta/max(dist,.001))-.12,0.);
              occlusion+=horizon*(1.-smoothstep(.05,radius,dist));
            }
            color*=1.-clamp(occlusion/12.*aoStrength*2.5,0.,.34);
            vec2 texel=1./resolution;
            vec3 blur=(texture2D(colorMap,screenUv+vec2(texel.x,0)).rgb+texture2D(colorMap,screenUv-vec2(texel.x,0)).rgb+texture2D(colorMap,screenUv+vec2(0,texel.y)).rgb+texture2D(colorMap,screenUv-vec2(0,texel.y)).rgb)*.25;
            color=max(vec3(0),color+(color-blur)*.1);
          }
          // Keep the concrete neutral, not glowing white or heavily blue-tinted.
          color*=vec3(1.015,1.005,.99);
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.scene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material),
    );
    this.resize();
  }
  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(Math.max(1, size.x), Math.max(1, size.y));
    this.material.uniforms.resolution.value.copy(size);
  }
  render(scene, camera) {
    const renderer = this.renderer,
      previous = renderer.getRenderTarget();
    this.material.uniforms.inverseProjection.value.copy(
      camera.projectionMatrixInverse,
    );
    this.material.uniforms.projectionScale.value =
      camera.projectionMatrix.elements[5];
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.scene.children[0].geometry.dispose();
  }
}

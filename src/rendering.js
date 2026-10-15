import * as THREE from "three";

// Depth-aware HDR finishing: local occlusion, quarter-resolution soft bloom,
// restrained sharpening and grading. Weapons/HUD are drawn afterwards.
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
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    this.bloomB = this.bloomA.clone();
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        colorMap: { value: this.target.texture },
        bloomMap: { value: this.bloomA.texture },
        bloomStrength: { value: 0.16 },
        depthMap: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        inverseProjection: { value: new THREE.Matrix4() },
        projectionScale: { value: 1 },
        aoStrength: { value: 1.05 },
      },
      vertexShader: `varying vec2 screenUv;void main(){screenUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `
        varying vec2 screenUv;
        uniform sampler2D colorMap,depthMap,bloomMap;
        uniform float bloomStrength;
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
          color=max(vec3(0.),(color-.18)*1.025+.18);
          color*=vec3(1.015,1.005,.99);
          color+=texture2D(bloomMap,screenUv).rgb*bloomStrength;
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    const filterOptions = {
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      vertexShader: this.material.vertexShader,
    };
    this.brightMaterial = new THREE.ShaderMaterial({
      ...filterOptions,
      uniforms: {
        inputMap: { value: this.target.texture },
        texel: { value: new THREE.Vector2() },
      },
      fragmentShader: `varying vec2 screenUv;uniform sampler2D inputMap;uniform vec2 texel;void main(){vec3 c=(texture2D(inputMap,screenUv+texel*vec2(-1,-1)).rgb+texture2D(inputMap,screenUv+texel*vec2(1,-1)).rgb+texture2D(inputMap,screenUv+texel*vec2(-1,1)).rgb+texture2D(inputMap,screenUv+texel*vec2(1,1)).rgb)*.25;float l=max(c.r,max(c.g,c.b));float knee=clamp(l-1.05,0.,.7);float contribution=max(l-1.4,knee*knee/2.8)/max(l,.001);gl_FragColor=vec4(min(c*contribution,vec3(8.)),1.);}`,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      ...filterOptions,
      uniforms: {
        inputMap: { value: null },
        direction: { value: new THREE.Vector2() },
      },
      fragmentShader: `varying vec2 screenUv;uniform sampler2D inputMap;uniform vec2 direction;void main(){vec3 c=texture2D(inputMap,screenUv).rgb*.227027;c+=(texture2D(inputMap,screenUv+direction*1.384615).rgb+texture2D(inputMap,screenUv-direction*1.384615).rgb)*.316216;c+=(texture2D(inputMap,screenUv+direction*3.230769).rgb+texture2D(inputMap,screenUv-direction*3.230769).rgb)*.070270;gl_FragColor=vec4(c,1.);}`,
    });
    this.resize();
  }
  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(Math.max(1, size.x), Math.max(1, size.y));
    this.material.uniforms.resolution.value.set(
      this.target.width,
      this.target.height,
    );
    this.bloomA.setSize(
      Math.max(1, Math.floor(size.x / 4)),
      Math.max(1, Math.floor(size.y / 4)),
    );
    this.bloomB.setSize(this.bloomA.width, this.bloomA.height);
    this.brightMaterial.uniforms.texel.value.set(
      1 / this.target.width,
      1 / this.target.height,
    );
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
    this.quad.material = this.brightMaterial;
    renderer.setRenderTarget(this.bloomA);
    renderer.render(this.scene, this.camera);
    this.quad.material = this.blurMaterial;
    this.blurMaterial.uniforms.inputMap.value = this.bloomA.texture;
    this.blurMaterial.uniforms.direction.value.set(1 / this.bloomA.width, 0);
    renderer.setRenderTarget(this.bloomB);
    renderer.render(this.scene, this.camera);
    this.blurMaterial.uniforms.inputMap.value = this.bloomB.texture;
    this.blurMaterial.uniforms.direction.value.set(0, 1 / this.bloomA.height);
    renderer.setRenderTarget(this.bloomA);
    renderer.render(this.scene, this.camera);
    this.quad.material = this.material;
    renderer.setRenderTarget(previous);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.quad.geometry.dispose();
  }
}

import * as THREE from "three";

// An analytic outdoor sky, drawn only where the opaque world left depth at 1.
// No skybox downloads, seams, camera clipping, shadow casting or depth pollution.
export class ArenaAtmosphere {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      uniforms: {
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        time: { value: 0 },
        cloudDetail: { value: 1 },
        sunDirection: { value: new THREE.Vector3(-20, 38, 15).normalize() },
        horizon: { value: new THREE.Color(0xc8d9e4) },
        zenith: { value: new THREE.Color(0x367ab1) },
      },
      vertexShader: `uniform mat4 inverseProjection,cameraWorld;varying vec3 worldRay;void main(){worldRay=mat3(cameraWorld)*(inverseProjection*vec4(position.xy,1.,1.)).xyz;gl_Position=vec4(position.xy,1.,1.);}`,
      fragmentShader: `
        varying vec3 worldRay;uniform vec3 sunDirection,horizon,zenith;uniform float time,cloudDetail;
        float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float cloud(vec2 p){float n=.5*noise(p);p=p*2.03+13.4;n+=.25*noise(p);if(cloudDetail>.5){p=p*2.07+7.3;n+=.125*noise(p);n+=.0625*noise(p*2.01);}return n;}
        void main(){
          vec3 ray=normalize(worldRay);float altitude=max(ray.y,0.);
          vec3 color=mix(horizon,zenith,pow(altitude,.42));
          float sun=max(dot(ray,sunDirection),0.);
          color+=vec3(.55,.36,.15)*pow(sun,110.);
          color+=vec3(12.,10.,7.)*smoothstep(.99994,.99999,sun);
          vec2 uv=ray.xz/(altitude*.65+.28)*3.2+vec2(time*.004,time*.001);
          float density=smoothstep(.43,.69,cloud(uv))*smoothstep(.015,.22,altitude);
          float edge=cloud(uv+vec2(.08,.04));
          vec3 clouds=mix(vec3(.56,.65,.72),vec3(1.15,1.13,1.07),smoothstep(.35,.65,edge));
          color=mix(color,clouds,density*.78);
          color=mix(horizon*.7,color,smoothstep(-.15,.025,ray.y));
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      this.material.uniforms.inverseProjection.value.copy(
        camera.projectionMatrixInverse,
      );
      this.material.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    };
  }
  update(time, performance = false) {
    this.material.uniforms.time.value = time;
    this.material.uniforms.cloudDetail.value = performance ? 0 : 1;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

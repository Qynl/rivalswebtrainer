import * as THREE from "three";

// Fixed vertex ownership: one indexed camera-facing quad per visible shot.
// Unlike WebGL lineWidth, this stays legible on browsers with one-pixel lines.
export function createTracerRibbons(capacity) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, width] of [
    ["position", 3],
    ["partner", 3],
    ["color", 3],
    ["alpha", 1],
  ])
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(
        new Float32Array(capacity * 4 * width),
        width,
      ).setUsage(THREE.DynamicDrawUsage),
    );
  const edge = new Float32Array(capacity * 4),
    along = new Float32Array(capacity * 4),
    indices = [];
  for (let i = 0; i < capacity; i++) {
    edge.set([-1, 1, -1, 1], i * 4);
    along.set([0, 0, 1, 1], i * 4);
    const v = i * 4;
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  geometry.setAttribute("edge", new THREE.BufferAttribute(edge, 1));
  geometry.setAttribute("along", new THREE.BufferAttribute(along, 1));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { viewport: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `
      attribute vec3 partner,color;attribute float alpha,edge,along;
      uniform vec2 viewport;varying vec3 tint;varying float opacity,crossTrail,trail;
      void main(){
        vec4 p=modelViewMatrix*vec4(position,1.),q=modelViewMatrix*vec4(partner,1.);
        opacity=alpha;
        // Clip crossing segments to the near plane BEFORE perspective division.
        // A shot behind the camera must never become a screen-spanning flash.
        if(p.z>-.08){if(q.z>=-.08)opacity=0.;else p=mix(p,q,(-.08-p.z)/(q.z-p.z));}
        if(q.z>-.08){if(p.z>=-.08)opacity=0.;else q=mix(q,p,(-.08-q.z)/(p.z-q.z));}
        vec4 a=projectionMatrix*p,b=projectionMatrix*q;
        vec2 delta=(b.xy/max(b.w,.0001)-a.xy/max(a.w,.0001))*viewport;
        if(along>.5)delta=-delta;
        float span=length(delta);vec2 tangent=span>.001?delta/span:vec2(1.,0.);
        float radius=clamp(.012*viewport.y*projectionMatrix[1][1]/max(.08,-p.z),.7,2.2);
        a.xy+=vec2(-tangent.y,tangent.x)*edge*radius*2./max(viewport,vec2(1.))*a.w;
        gl_Position=a;tint=color;crossTrail=edge;trail=along;
      }`,
    fragmentShader: `
      varying vec3 tint;varying float opacity,crossTrail,trail;
      void main(){
        float edge=abs(crossTrail),core=pow(max(0.,1.-edge),3.);
        float cap=smoothstep(0.,.10,trail)*(1.-smoothstep(.88,1.,trail));
        float alpha=(1.-smoothstep(.15,1.,edge))*cap*opacity;
        if(alpha<.005)discard;
        gl_FragColor=vec4(mix(tint*.42,tint+vec3(.3),core),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "pooled-tracer-ribbons";
  mesh.onBeforeRender = (renderer) =>
    renderer.getDrawingBufferSize(material.uniforms.viewport.value);
  return mesh;
}

export function writeTracerSegment(
  attributes,
  index,
  state,
  tail,
  head,
  opacity,
) {
  const { a, b } = state;
  const tx = a.x + (b.x - a.x) * tail,
    ty = a.y + (b.y - a.y) * tail,
    tz = a.z + (b.z - a.z) * tail;
  const hx = a.x + (b.x - a.x) * head,
    hy = a.y + (b.y - a.y) * head,
    hz = a.z + (b.z - a.z) * head;
  for (let k = 0; k < 4; k++) {
    const v = index * 4 + k,
      start = k < 2;
    attributes.position.setXYZ(
      v,
      start ? tx : hx,
      start ? ty : hy,
      start ? tz : hz,
    );
    attributes.partner.setXYZ(
      v,
      start ? hx : tx,
      start ? hy : ty,
      start ? hz : tz,
    );
    attributes.alpha.setX(v, opacity);
  }
  for (const name of ["position", "partner", "alpha"])
    attributes[name].needsUpdate = true;
}

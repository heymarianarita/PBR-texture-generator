// three.js preview: a lit plane or sphere with the generated maps applied.
// The pointer moves a point light; when idle the light orbits slowly.

export async function createPreview(container) {
  const THREE = await import('three');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0b0834); // MDS --surface-window
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.PointLight(0xffffff, 3.2, 0, 0); // no falloff: only direction matters
  scene.add(light);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x4edaa7 /* MDS mint */ }),
  );
  scene.add(marker);

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
  sphere.visible = false;
  scene.add(plane, sphere);

  const opts = { shape: 'plane', tile: false, flipGreen: false, showColor: true, orm: false, lightHeight: 0.6 };
  let textures = {};
  let imageAspect = 1;

  // ---- Light control ----
  const el = renderer.domElement;
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const target = new THREE.Vector2(0.6, 0.6);
  const current = target.clone();
  let pointerInside = false;
  let orbitAngle = Math.PI / 4;

  function onPointer(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hit)) target.set(hit.x, hit.y);
    pointerInside = true;
  }
  el.addEventListener('pointermove', onPointer);
  el.addEventListener('pointerdown', (e) => {
    onPointer(e);
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointerleave', () => { pointerInside = false; orbitAngle = Math.atan2(current.y, current.x); });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') { pointerInside = false; orbitAngle = Math.atan2(current.y, current.x); }
  });

  // ---- Layout ----
  function objectSize() {
    if (opts.shape === 'sphere') return [2, 2];
    return imageAspect >= 1 ? [2, 2 / imageAspect] : [2 * imageAspect, 2];
  }

  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const [pw, ph] = objectSize();
    plane.scale.set(pw / 2, ph / 2, 1);
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fill = 0.88;
    const dist = Math.max(ph / 2 / (t * fill), pw / 2 / (t * camera.aspect * fill));
    camera.position.set(0, 0, dist + (opts.shape === 'sphere' ? 1 : 0));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(layout).observe(container);

  // ---- Textures ----
  function applyTextureOptions() {
    const rep = opts.tile ? 2 : 1;
    for (const t of Object.values(textures)) {
      const wrapMode = opts.tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.wrapS = t.wrapT = wrapMode;
      t.repeat.set(rep, rep);
      t.needsUpdate = true;
    }
    material.map = opts.showColor ? textures.albedo || null : null;
    // ORM on: occlusion, roughness and metallic all read from the packed map
    // (R, G, B), as in glTF. Off: roughness only, never metallic.
    const orm = opts.orm ? textures.orm || null : null;
    material.aoMap = orm;
    material.metalnessMap = orm;
    material.metalness = orm ? 1 : 0;
    material.roughnessMap = orm || textures.rough || null;
    // three.js reads normal maps as OpenGL; flip Y so a DirectX map still previews correctly.
    material.normalScale.set(1, opts.flipGreen ? -1 : 1);
    material.needsUpdate = true;
  }

  // ---- Render loop ----
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const [pw, ph] = objectSize();
    if (!pointerInside) {
      orbitAngle += dt * 0.7;
      const R = 0.75 * Math.min(pw, ph) / 2 + (opts.shape === 'sphere' ? 0.3 : 0);
      target.set(Math.cos(orbitAngle) * R, Math.sin(orbitAngle) * R);
    }
    current.lerp(target, 1 - Math.pow(0.0005, dt));
    const z = opts.lightHeight + (opts.shape === 'sphere' ? 1 : 0);
    light.position.set(current.x, current.y, z);
    marker.position.copy(light.position);
    if (opts.shape === 'sphere') sphere.rotation.y += dt * 0.12;
    renderer.render(scene, camera);
  });

  return {
    // Bind new canvases (call after loading a new image).
    setSource({ albedo, normal, rough, orm }) {
      for (const t of Object.values(textures)) t.dispose();
      const aniso = renderer.capabilities.getMaxAnisotropy();
      const make = (canvas, srgb) => {
        const t = new THREE.CanvasTexture(canvas);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        return t;
      };
      textures = { albedo: make(albedo, true), normal: make(normal), rough: make(rough), orm: make(orm) };
      material.normalMap = textures.normal;
      imageAspect = albedo.width / albedo.height;
      applyTextureOptions();
      layout();
    },
    // Re-upload canvases whose contents changed.
    refresh({ normal, rough, orm }) {
      if (normal && textures.normal) textures.normal.needsUpdate = true;
      if (rough && textures.rough) textures.rough.needsUpdate = true;
      if (orm && textures.orm) textures.orm.needsUpdate = true;
    },
    setOptions(next) {
      const shapeChanged = next.shape !== undefined && next.shape !== opts.shape;
      const texChanged = ['tile', 'showColor', 'flipGreen', 'orm'].some((k) => k in next && next[k] !== opts[k]);
      Object.assign(opts, next);
      plane.visible = opts.shape === 'plane';
      sphere.visible = opts.shape === 'sphere';
      if (texChanged) applyTextureOptions();
      if (shapeChanged) layout();
    },
  };
}

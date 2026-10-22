// three.js preview: a lit plane or sphere with the generated maps applied as
// a PBR material. The light stays still. Dragging moves the light on the
// plane and rotates the sphere.
// Wheel or pinch zooms towards the pointer; double-click resets the zoom.

export async function createPreview(container) {
  const THREE = await import('three');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.PointLight(0xffffff, 3.2, 0, 0); // no falloff: only direction matters
  scene.add(light);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  marker.visible = false; // shown only while dragging the light
  scene.add(marker);

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), material);
  sphere.visible = false;
  scene.add(plane, sphere);

  const opts = { shape: 'plane', tile: false, flipGreen: false, lightHeight: 0.7 };
  let textures = {};
  let imageAspect = 1;

  const el = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  const toNdc = (e, out = new THREE.Vector2()) => {
    const r = el.getBoundingClientRect();
    return out.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  function objectSize() {
    if (opts.shape === 'sphere') return [2, 2];
    return imageAspect >= 1 ? [2, 2 / imageAspect] : [2 * imageAspect, 2];
  }

  // ---- Light: fixed, raking from the top left, until dragged ----
  const lightTarget = new THREE.Vector2(-0.6, 0.6);
  const lightPos = lightTarget.clone();
  let dragId = null;

  // ---- Sphere rotation: drag turns it about the screen's axes ----
  const ROTATE_SPEED = 0.008; // radians per pixel
  const lastDrag = { x: 0, y: 0 };
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  const turn = new THREE.Quaternion();

  function rotateSphere(e) {
    const dx = e.clientX - lastDrag.x, dy = e.clientY - lastDrag.y;
    lastDrag.x = e.clientX;
    lastDrag.y = e.clientY;
    sphere.quaternion.premultiply(turn.setFromAxisAngle(axisY, dx * ROTATE_SPEED));
    sphere.quaternion.premultiply(turn.setFromAxisAngle(axisX, dy * ROTATE_SPEED));
  }

  function moveLight(e) {
    raycaster.setFromCamera(toNdc(e), camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;
    const [pw, ph] = objectSize();
    lightTarget.set(THREE.MathUtils.clamp(hit.x, -pw, pw), THREE.MathUtils.clamp(hit.y, -ph, ph));
  }

  function endDrag() {
    dragId = null;
    marker.visible = false;
    el.classList.remove('dragging');
  }

  // ---- Zoom ----
  // zoom = 1 fits the object in view. The camera looks straight down -z and
  // pans in x/y; `zoomTarget`/`panTarget` are eased towards each frame.
  const MIN_ZOOM = 0.5, MAX_ZOOM = 12;
  let zoom = 1, zoomTarget = 1;
  const pan = new THREE.Vector2(), panTarget = new THREE.Vector2();
  let baseDist = 4;
  let onZoomChange = () => {};

  // Half-size of the visible area at the object's front surface, per unit of ndc.
  const viewHalf = (z) => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = baseDist / z;
    return [d * t * camera.aspect, d * t];
  };

  function clampPan(v, z) {
    const [pw, ph] = objectSize();
    const k = Math.max(0, 1 - 1 / z);
    v.x = THREE.MathUtils.clamp(v.x, -pw / 2 * k, pw / 2 * k);
    v.y = THREE.MathUtils.clamp(v.y, -ph / 2 * k, ph / 2 * k);
    return v;
  }

  // Zoom by `factor`, keeping the point under `at` (ndc) fixed.
  function zoomBy(factor, at = new THREE.Vector2()) {
    const next = THREE.MathUtils.clamp(zoomTarget * factor, MIN_ZOOM, MAX_ZOOM);
    const [hx, hy] = viewHalf(zoomTarget);
    const [nx, ny] = viewHalf(next);
    const px = panTarget.x + at.x * hx, py = panTarget.y + at.y * hy;
    panTarget.set(px - at.x * nx, py - at.y * ny);
    zoomTarget = next;
    clampPan(panTarget, zoomTarget);
    onZoomChange(zoomTarget);
  }

  function resetZoom() {
    zoomTarget = 1;
    panTarget.set(0, 0);
    onZoomChange(zoomTarget);
  }

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as a wheel event with ctrlKey and small deltas.
    const speed = e.ctrlKey ? 0.01 : 0.0015;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomBy(Math.exp(-delta * speed), toNdc(e));
  }, { passive: false });
  el.addEventListener('dblclick', resetZoom);

  // ---- Pointers: one drags the light, two touches pinch-zoom ----
  const touches = new Map();
  let pinchDist = 0;
  const pinchInfo = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      mid: { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 } };
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, e);
    if (touches.size === 2) {
      endDrag();
      pinchDist = pinchInfo().dist;
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragId = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('dragging');
    if (opts.shape === 'sphere') {
      lastDrag.x = e.clientX;
      lastDrag.y = e.clientY;
    } else {
      marker.visible = true;
      moveLight(e);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, e);
    if (touches.size === 2) {
      const { dist, mid } = pinchInfo();
      if (pinchDist > 0) zoomBy(dist / pinchDist, toNdc(mid));
      pinchDist = dist;
      return;
    }
    if (e.pointerId !== dragId) return;
    if (opts.shape === 'sphere') rotateSphere(e);
    else moveLight(e);
  });
  const release = (e) => {
    touches.delete(e.pointerId);
    pinchDist = 0;
    if (e.pointerId === dragId) endDrag();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  // ---- Layout ----
  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const [pw, ph] = objectSize();
    plane.scale.set(pw / 2, ph / 2, 1);
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fill = 0.88;
    baseDist = Math.max(ph / 2 / (t * fill), pw / 2 / (t * camera.aspect * fill));
    camera.updateProjectionMatrix();
    placeCamera();
  }

  // The object's front surface sits at z = 0 (plane) or z = 1 (sphere).
  function placeCamera() {
    const front = opts.shape === 'sphere' ? 1 : 0;
    camera.position.set(pan.x, pan.y, front + baseDist / zoom);
    camera.lookAt(pan.x, pan.y, 0);
  }
  new ResizeObserver(layout).observe(container);

  // ---- Textures ----
  // A glTF-style material: colour, normal, and ORM (occlusion, roughness,
  // metallic in R, G, B).
  function applyTextureOptions() {
    const rep = opts.tile ? 2 : 1;
    for (const t of Object.values(textures)) {
      const wrapMode = opts.tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.wrapS = t.wrapT = wrapMode;
      t.repeat.set(rep, rep);
      t.needsUpdate = true;
    }
    material.map = textures.albedo || null;
    material.normalMap = textures.normal || null;
    material.aoMap = textures.orm || null;
    material.roughnessMap = textures.orm || null;
    material.metalnessMap = textures.orm || null;
    // three.js reads normal maps as OpenGL; flip Y so a DirectX map still previews correctly.
    material.normalScale.set(1, opts.flipGreen ? -1 : 1);
    material.needsUpdate = true;
  }

  // ---- Render loop ----
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const ease = 1 - Math.pow(0.000005, dt);
    lightPos.lerp(lightTarget, ease);
    const z = opts.lightHeight + (opts.shape === 'sphere' ? 1 : 0);
    light.position.set(lightPos.x, lightPos.y, z);
    marker.position.copy(light.position);
    zoom += (zoomTarget - zoom) * ease;
    pan.lerp(panTarget, ease);
    placeCamera();
    renderer.render(scene, camera);
  });

  return {
    // Bind new canvases (call after loading a new image).
    setSource({ albedo, normal, orm }) {
      for (const t of Object.values(textures)) t.dispose();
      const aniso = renderer.capabilities.getMaxAnisotropy();
      const make = (canvas, srgb) => {
        const t = new THREE.CanvasTexture(canvas);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        return t;
      };
      textures = { albedo: make(albedo, true), normal: make(normal), orm: make(orm) };
      imageAspect = albedo.width / albedo.height;
      applyTextureOptions();
      layout();
    },
    // Re-upload canvases whose contents changed.
    refresh({ normal, orm }) {
      if (normal && textures.normal) textures.normal.needsUpdate = true;
      if (orm && textures.orm) textures.orm.needsUpdate = true;
    },
    setOptions(next) {
      const shapeChanged = next.shape !== undefined && next.shape !== opts.shape;
      const texChanged = ['tile', 'flipGreen'].some((k) => k in next && next[k] !== opts[k]);
      Object.assign(opts, next);
      plane.visible = opts.shape === 'plane';
      sphere.visible = opts.shape === 'sphere';
      if (texChanged) applyTextureOptions();
      if (shapeChanged) { resetZoom(); layout(); }
    },
    setBackground(color) {
      renderer.setClearColor(color);
    },
    resize: layout,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    resetZoom,
    // `fn(zoom)` is called whenever the zoom level changes (1 = fit).
    onZoom(fn) { onZoomChange = fn; fn(zoomTarget); },
  };
}

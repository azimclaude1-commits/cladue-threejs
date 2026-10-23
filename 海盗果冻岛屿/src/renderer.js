// WebGPU renderer: shadow map -> opaque scene (+ underwater particles) -> jelly -> particles -> post.
import { COMMON, SHADOW_FNS, MESH_PASS, STUDIO_PASS, JELLY_PASS, BLIT_PASS, PARTICLE_PASS, POST_PASS } from './shaders.js';
import { VF } from './builder.js';
import { OBJ } from './geometry.js';
import { m4 } from './math.js';
import { HALF } from './world.js';

const SHADOW = 2048;
const GRID = 128;
const FRAME_FLOATS = 5 * 16 + 14 * 4 + 9 * 4;

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('no-webgpu');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no-adapter');
    const device = await adapter.requestDevice();
    const r = new Renderer(canvas, adapter, device);
    await r.init();
    return r;
  }

  constructor(canvas, adapter, device) {
    this.canvas = canvas;
    this.adapter = adapter;
    this.device = device;
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.srgbOut = !this.format.endsWith('-srgb');
    this.F = new Float32Array(FRAME_FLOATS);
    this.objData = new Float32Array(OBJ.COUNT * 16);
    this.width = 0; this.height = 0;
    this.errors = [];
    device.lost.then((i) => { this.lost = i.message; console.error('device lost', i.message); });
    device.addEventListener?.('uncapturederror', (e) => { this.errors.push(e.error.message); console.error(e.error.message); });
  }

  async init() {
    const d = this.device;
    const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;
    this.frameBuf = d.createBuffer({ size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.objBuf = d.createBuffer({ size: OBJ.COUNT * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.etaTex = d.createTexture({ size: [GRID, GRID], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.groundTex = d.createTexture({ size: [256, 256], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.shadowTex = d.createTexture({ size: [SHADOW, SHADOW], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.cmp = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.lin = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    this.bgl0 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
    ] });
    this.bgl1 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | Fr, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: V | Fr, sampler: { type: 'comparison' } },
      { binding: 2, visibility: V | Fr, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: V | Fr, texture: { sampleType: 'unfilterable-float' } },
    ] });
    this.bgl2 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 1, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: Fr, sampler: { type: 'filtering' } },
    ] });
    this.bglTex = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } }] });
    this.bglPost = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: Fr, buffer: { type: 'uniform' } },
    ] });

    const mod = async (label, code) => {
      const m = d.createShaderModule({ label, code });
      const info = await m.getCompilationInfo();
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length) {
        const lines = code.split('\n');
        throw new Error(`${label}: ` + errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}\n  > ${lines[e.lineNum - 1]}`).join('\n'));
      }
      return m;
    };
    const meshMod = await mod('mesh', COMMON + SHADOW_FNS + MESH_PASS);
    const studioMod = await mod('studio', COMMON + SHADOW_FNS + STUDIO_PASS);
    const jellyMod = await mod('jelly', COMMON + SHADOW_FNS + JELLY_PASS);
    const blitMod = await mod('blit', BLIT_PASS);
    const partMod = await mod('particles', COMMON + PARTICLE_PASS);
    const postMod = await mod('post', POST_PASS);

    const L = (...g) => d.createPipelineLayout({ bindGroupLayouts: g });
    const HDR = 'rgba16float';
    const meshVB = [{ arrayStride: VF * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32' },
      { shaderLocation: 4, offset: 40, format: 'float32x2' }, { shaderLocation: 5, offset: 48, format: 'float32' },
    ] }];
    this.pShadow = d.createRenderPipeline({
      layout: L(this.bgl0),
      vertex: { module: meshMod, entryPoint: 'vsMeshShadow', buffers: meshVB },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 },
    });
    const mrt = [{ format: HDR }, { format: 'r32float' }];
    this.pStudio = d.createRenderPipeline({
      layout: L(this.bgl0, this.bgl1),
      vertex: { module: studioMod, entryPoint: 'vsFull' },
      fragment: { module: studioMod, entryPoint: 'fsStudio', targets: mrt },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.pMesh = d.createRenderPipeline({
      layout: L(this.bgl0, this.bgl1),
      vertex: { module: meshMod, entryPoint: 'vsMesh', buffers: meshVB },
      fragment: { module: meshMod, entryPoint: 'fsMesh', targets: mrt },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.pBlit = d.createRenderPipeline({
      layout: L(this.bglTex),
      vertex: { module: blitMod, entryPoint: 'vsFull' },
      fragment: { module: blitMod, entryPoint: 'fsBlit', targets: [{ format: HDR }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.pJelly = d.createRenderPipeline({
      layout: L(this.bgl0, this.bgl1, this.bgl2),
      vertex: { module: jellyMod, entryPoint: 'vsJelly' },
      fragment: { module: jellyMod, entryPoint: 'fsJelly', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const partVB = [{ arrayStride: 48, stepMode: 'instance', attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' },
    ] }];
    const pblend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    this.pPart = d.createRenderPipeline({
      layout: L(this.bgl0, this.bglTex),
      vertex: { module: partMod, entryPoint: 'vsPart', buffers: partVB },
      fragment: { module: partMod, entryPoint: 'fsPart', targets: [{ format: HDR, blend: pblend }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });
    this.pPost = d.createRenderPipeline({
      layout: L(this.bglPost),
      vertex: { module: postMod, entryPoint: 'vsFull' },
      fragment: { module: postMod, entryPoint: 'fsPost', targets: [{ format: this.format }] },
    });

    this.bg0 = d.createBindGroup({ layout: this.bgl0, entries: [{ binding: 0, resource: { buffer: this.frameBuf } }, { binding: 1, resource: { buffer: this.objBuf } }] });
    this.bg1 = d.createBindGroup({ layout: this.bgl1, entries: [
      { binding: 0, resource: this.shadowTex.createView() }, { binding: 1, resource: this.cmp },
      { binding: 2, resource: this.etaTex.createView() }, { binding: 3, resource: this.groundTex.createView() },
    ] });

    // jelly index buffers: top grid and the 4 walls (vertex = col * 2 + row)
    const top = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, e = c + 1;
      top.push(a, c, b, b, c, e);
    }
    const wall = [];
    for (let i = 0; i < GRID; i++) { const a = i * 2, b = a + 1, c = a + 2, e = a + 3; wall.push(a, b, c, c, b, e); }
    this.topIdx = this.indexBuffer(new Uint32Array(top));
    this.topCount = top.length;
    this.wallIdx = this.indexBuffer(new Uint32Array(wall));
    this.wallCount = wall.length;
    this.partBuf = d.createBuffer({ size: 2600 * 48, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  indexBuffer(arr) {
    const b = this.device.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, arr);
    return b;
  }

  setScene(mesh) {
    const d = this.device;
    this.meshVB = d.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.meshVB, 0, mesh.vertices);
    this.meshIB = this.indexBuffer(mesh.indices);
    this.meshCount = mesh.indices.length;
  }

  setGround(data) { this.device.queue.writeTexture({ texture: this.groundTex }, data, { bytesPerRow: 256 * 4 }, [256, 256]); }
  setEta(data) { this.device.queue.writeTexture({ texture: this.etaTex }, data, { bytesPerRow: GRID * 4 }, [GRID, GRID]); }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    for (const t of [this.sceneTex, this.distTex, this.hdrTex, this.depthTex]) t?.destroy();
    this.sceneTex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: RA | TB });
    this.distTex = d.createTexture({ size: [w, h], format: 'r32float', usage: RA | TB });
    this.hdrTex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: RA | TB });
    this.depthTex = d.createTexture({ size: [w, h], format: 'depth24plus', usage: RA });
    this.bg2 = d.createBindGroup({ layout: this.bgl2, entries: [
      { binding: 0, resource: this.sceneTex.createView() }, { binding: 1, resource: this.distTex.createView() }, { binding: 2, resource: this.lin },
    ] });
    this.bgScene = d.createBindGroup({ layout: this.bglTex, entries: [{ binding: 0, resource: this.sceneTex.createView() }] });
    this.bgDist = d.createBindGroup({ layout: this.bglTex, entries: [{ binding: 0, resource: this.distTex.createView() }] });
    this.bgPost = d.createBindGroup({ layout: this.bglPost, entries: [{ binding: 0, resource: this.hdrTex.createView() }, { binding: 1, resource: { buffer: this.postBuf } }] });
  }

  /** s: { camera, block, blockInv, light..., particles: {data, under, count} } */
  render(s) {
    const d = this.device, F = this.F;
    let o = 0;
    const put16 = (m) => { F.set(m, o); o += 16; };
    const put4 = (a, w = a[3] ?? 0) => { F[o] = a[0]; F[o + 1] = a[1]; F[o + 2] = a[2]; F[o + 3] = w; o += 4; };
    put16(s.camera.viewProj); put16(s.camera.invViewProj);
    // directional light (sun or moon), orthographic, fitted to the diorama
    const L = s.light.dir;
    const ctr = [0, 0.9, 0];
    const lv = m4.lookAt([ctr[0] + L[0] * 10, ctr[1] + L[1] * 10, ctr[2] + L[2] * 10], ctr, Math.abs(L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
    put16(m4.mul(m4.ortho(-4.6, 4.6, -4.6, 4.6, 0.5, 22), lv));
    put16(s.block); put16(s.blockInv);
    put4(s.camera.pos, s.time);
    put4(L, s.light.intensity);
    put4(s.light.color, s.night);
    put4(s.ambSky); put4(s.ambGround);
    put4(s.fire.pos, s.fire.intensity);
    put4(s.fire.color, s.fire.flicker);
    put4(s.backTop); put4(s.backBot, s.stars);
    put4([this.width, this.height, 1 / this.width], 1 / this.height);
    put4(s.jelly.absorb, s.jelly.scatter);
    put4(s.jelly.color, s.jelly.foam);
    put4([s.wind[0], s.wind[1], s.wind[2]], s.wind[3] ?? 0);
    put4([SHADOW, s.motion, s.lantern], s.skullGlow);
    for (let i = 0; i < 9; i++) put4(s.palms[i] || [0, 0, 0, 0]);
    const q = d.queue;
    q.writeBuffer(this.frameBuf, 0, F);
    q.writeBuffer(this.objBuf, 0, s.objects);
    q.writeBuffer(this.postBuf, 0, new Float32Array([s.exposure ?? 1, this.srgbOut ? 1 : 0, (s.time * 60) % 1000, 0]));
    const P = s.particles;
    if (P.count) q.writeBuffer(this.partBuf, 0, P.data, 0, P.count * 12);

    const enc = d.createCommandEncoder();
    const drawMesh = (pass) => {
      pass.setVertexBuffer(0, this.meshVB);
      pass.setIndexBuffer(this.meshIB, 'uint32');
      pass.drawIndexed(this.meshCount);
    };
    { // shadow
      const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setPipeline(this.pShadow); pass.setBindGroup(0, this.bg0); drawMesh(pass); pass.end();
    }
    { // opaque scene
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: this.sceneTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
          { view: this.distTex.createView(), clearValue: { r: 1e4, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.bg0); pass.setBindGroup(1, this.bg1);
      pass.setPipeline(this.pStudio); pass.draw(3);
      pass.setPipeline(this.pMesh); drawMesh(pass);
      pass.end();
    }
    if (P.under) { // underwater particles go into the scene so the jelly refracts them
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.sceneTex.createView(), loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      // (soft particles read distTex, which isn't an attachment here)
      pass.setPipeline(this.pPart); pass.setBindGroup(0, this.bg0); pass.setBindGroup(1, this.bgDist);
      pass.setVertexBuffer(0, this.partBuf); pass.draw(4, P.under, 0, 0);
      pass.end();
    }
    { // jelly
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.hdrTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.pBlit); pass.setBindGroup(0, this.bgScene); pass.draw(3);
      pass.setPipeline(this.pJelly);
      pass.setBindGroup(0, this.bg0); pass.setBindGroup(1, this.bg1); pass.setBindGroup(2, this.bg2);
      pass.setIndexBuffer(this.topIdx, 'uint32'); pass.drawIndexed(this.topCount, 1, 0, 0, 0);
      if (!this.dbgNoWalls) { pass.setIndexBuffer(this.wallIdx, 'uint32'); pass.drawIndexed(this.wallCount, 4, 0, 0, 1); }
      // particles above the water
      if (P.count > P.under) {
        pass.setPipeline(this.pPart); pass.setBindGroup(0, this.bg0); pass.setBindGroup(1, this.bgDist);
        pass.setVertexBuffer(0, this.partBuf); pass.draw(4, P.count - P.under, 0, P.under);
      }
      pass.end();
    }
    { // post
      const view = this._cap ? this._cap.createView() : this.context.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pPost); pass.setBindGroup(0, this.bgPost); pass.draw(3); pass.end();
    }
    if (this._cap) {
      const bpr = Math.ceil((this.width * 4) / 256) * 256;
      this._capBuf = d.createBuffer({ size: bpr * this.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: this._cap }, { buffer: this._capBuf, bytesPerRow: bpr }, [this.width, this.height]);
      this._capBpr = bpr;
    }
    q.submit([enc.finish()]);
  }

  /** Debug: render one frame offscreen and return a PNG data URL. */
  async capture(state) {
    const w = this.width, h = this.height;
    this._cap = this.device.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.render(state);
    const buf = this._capBuf, bpr = this._capBpr;
    this._cap.destroy(); this._cap = null;
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h);
    const bgra = this.format.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * bpr + x * 4, o = (y * w + x) * 4;
      img.data[o] = src[i + (bgra ? 2 : 0)]; img.data[o + 1] = src[i + 1]; img.data[o + 2] = src[i + (bgra ? 0 : 2)]; img.data[o + 3] = 255;
    }
    buf.unmap();
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
}
export { GRID };

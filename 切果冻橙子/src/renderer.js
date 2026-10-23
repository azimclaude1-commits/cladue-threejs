// WebGPU renderer: shadow map, contact height map, back-face thickness, studio, jelly, knife, post.
import { COMMON, ANATOMY, LIGHTING, SHADOW_SAMPLING, FULLSCREEN_VS, DEPTH_PASS, STUDIO_PASS, BLIT_PASS, POST_PASS, JELLY_PASS, LINES_PASS, KNIFE_PASS } from './shaders.js';
import { m4 } from './math.js';
import { PIP_COUNT, SEGMENTS } from './orange.js';

const SHADOW_SIZE = 2048;
const HEIGHT_SIZE = 256;
const FRAME_FLOATS = 320;
const VTX_FLOATS = 28; // 112 bytes

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('no-webgpu');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no-adapter');
    const device = await adapter.requestDevice();
    const r = new Renderer(canvas, device);
    r.adapter = adapter; // keep the adapter alive (losing it can drop the device)
    await r.init();
    return r;
  }

  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.srgbOut = !this.format.endsWith('-srgb');
    this.frameData = new Float32Array(FRAME_FLOATS);
    this.width = 0;
    this.height = 0;
    this.indexCount = 0;
    this.lineCount = 0;
    this.nodeCapacity = 0;
    this.errors = [];
    device.lost.then((info) => { this.lost = info.reason + ': ' + info.message; console.error('device lost', info.reason, info.message); });
    device.addEventListener?.('uncapturederror', (e) => { this.errors.push(e.error.message); console.error(e.error.message); });
  }

  async init() {
    const d = this.device;
    const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;
    this.frameBuf = d.createBuffer({ size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.knifeBuf = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.bglGeom = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
    ] });
    const shadowEntries = [
      { binding: 0, visibility: Fr, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: Fr, sampler: { type: 'comparison' } },
      { binding: 2, visibility: Fr, texture: { sampleType: 'depth' } },
    ];
    this.bglStudio = d.createBindGroupLayout({ entries: shadowEntries });
    this.bglMain = d.createBindGroupLayout({ entries: [
      ...shadowEntries,
      { binding: 3, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 4, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: Fr, sampler: { type: 'filtering' } },
    ] });
    this.bglTex = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } }] });
    this.bglPost = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: Fr, buffer: { type: 'uniform' } },
    ] });
    this.bglKnife = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform' } }] });

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
    const geomMod = await mod('depth', COMMON + DEPTH_PASS);
    const studioMod = await mod('studio', COMMON + LIGHTING + SHADOW_SAMPLING + FULLSCREEN_VS + STUDIO_PASS);
    const jellyMod = await mod('jelly', COMMON + ANATOMY + LIGHTING + SHADOW_SAMPLING + JELLY_PASS);
    const blitMod = await mod('blit', FULLSCREEN_VS + BLIT_PASS);
    const postMod = await mod('post', FULLSCREEN_VS + POST_PASS);
    const linesMod = await mod('lines', COMMON + LINES_PASS);
    const knifeMod = await mod('knife', COMMON + LIGHTING + KNIFE_PASS);

    const layout = (...g) => d.createPipelineLayout({ bindGroupLayouts: g });
    const plGeom = layout(this.bglGeom);
    const HDR = 'rgba16float';

    this.pShadow = d.createRenderPipeline({
      layout: plGeom,
      vertex: { module: geomMod, entryPoint: 'vsShadow' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
    });
    this.pHeight = d.createRenderPipeline({
      layout: plGeom,
      vertex: { module: geomMod, entryPoint: 'vsHeight' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.pBack = d.createRenderPipeline({
      layout: plGeom,
      vertex: { module: geomMod, entryPoint: 'vsBack' },
      fragment: { module: geomMod, entryPoint: 'fsBack', targets: [{ format: 'r32float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.pStudio = d.createRenderPipeline({
      layout: layout(this.bglGeom, this.bglStudio),
      vertex: { module: studioMod, entryPoint: 'vsFull' },
      fragment: { module: studioMod, entryPoint: 'fsStudio', targets: [{ format: HDR }] },
    });
    this.pBlit = d.createRenderPipeline({
      layout: layout(this.bglTex),
      vertex: { module: blitMod, entryPoint: 'vsFull' },
      fragment: { module: blitMod, entryPoint: 'fsBlit', targets: [{ format: HDR }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.pJelly = d.createRenderPipeline({
      layout: layout(this.bglGeom, this.bglMain),
      vertex: { module: jellyMod, entryPoint: 'vsJelly' },
      fragment: { module: jellyMod, entryPoint: 'fsJelly', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.pLines = d.createRenderPipeline({
      layout: plGeom,
      vertex: { module: linesMod, entryPoint: 'vsLines' },
      fragment: { module: linesMod, entryPoint: 'fsLines', targets: [{ format: HDR, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.pKnife = d.createRenderPipeline({
      layout: layout(this.bglGeom, this.bglKnife),
      vertex: { module: knifeMod, entryPoint: 'vsKnife', buffers: [{ arrayStride: 28, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32' },
      ] }] },
      fragment: { module: knifeMod, entryPoint: 'fsKnife', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.pPost = d.createRenderPipeline({
      layout: layout(this.bglPost),
      vertex: { module: postMod, entryPoint: 'vsFull' },
      fragment: { module: postMod, entryPoint: 'fsPost', targets: [{ format: this.format }] },
    });

    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.heightTex = d.createTexture({ size: [HEIGHT_SIZE, HEIGHT_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.cmpSampler = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.linSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.bgStudio = d.createBindGroup({ layout: this.bglStudio, entries: [
      { binding: 0, resource: this.shadowTex.createView() },
      { binding: 1, resource: this.cmpSampler },
      { binding: 2, resource: this.heightTex.createView() },
    ] });
    this.bgKnife = d.createBindGroup({ layout: this.bglKnife, entries: [{ binding: 0, resource: { buffer: this.knifeBuf } }] });
    this.knifeVB = null;
    this.ensureGeometryBuffers(16, 16, 16, 16);
  }

  // ---- size-dependent targets ---------------------------------------------------
  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    const tex = (format, usage) => d.createTexture({ size: [w, h], format, usage });
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    for (const t of [this.sceneTex, this.hdrTex, this.backTex, this.depthTex, this.backDepthTex]) t?.destroy();
    this.sceneTex = tex('rgba16float', RA | TB);
    this.hdrTex = tex('rgba16float', RA | TB);
    this.backTex = tex('r32float', RA | TB);
    this.depthTex = tex('depth24plus', RA);
    this.backDepthTex = tex('depth24plus', RA);
    this.bgMain = d.createBindGroup({ layout: this.bglMain, entries: [
      { binding: 0, resource: this.shadowTex.createView() },
      { binding: 1, resource: this.cmpSampler },
      { binding: 2, resource: this.heightTex.createView() },
      { binding: 3, resource: this.sceneTex.createView() },
      { binding: 4, resource: this.backTex.createView() },
      { binding: 5, resource: this.linSampler },
    ] });
    this.bgBlit = d.createBindGroup({ layout: this.bglTex, entries: [{ binding: 0, resource: this.sceneTex.createView() }] });
    this.bgPost = d.createBindGroup({ layout: this.bglPost, entries: [
      { binding: 0, resource: this.hdrTex.createView() },
      { binding: 1, resource: { buffer: this.postBuf } },
    ] });
  }

  // ---- geometry -------------------------------------------------------------------
  ensureGeometryBuffers(vertCount, indexCount, nodeCount, lineCount) {
    const d = this.device;
    const grow = (cur, need) => Math.max(need, Math.ceil(cur * 1.5));
    let changed = false;
    if (!this.vertBuf || this.vertCap < vertCount) {
      this.vertBuf?.destroy();
      this.vertCap = grow(this.vertCap || 0, vertCount);
      this.vertBuf = d.createBuffer({ size: this.vertCap * VTX_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      changed = true;
    }
    if (!this.indexBuf || this.indexCap < indexCount) {
      this.indexBuf?.destroy();
      this.indexCap = grow(this.indexCap || 0, indexCount);
      this.indexBuf = d.createBuffer({ size: this.indexCap * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    if (!this.nodeBuf || this.nodeCap < nodeCount) {
      this.nodeBuf?.destroy();
      this.nodeCap = grow(this.nodeCap || 0, nodeCount);
      this.nodeBuf = d.createBuffer({ size: this.nodeCap * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.nodeData = new Float32Array(this.nodeCap * 4);
      changed = true;
    }
    if (!this.lineBuf || this.lineCap < lineCount) {
      this.lineBuf?.destroy();
      this.lineCap = grow(this.lineCap || 0, lineCount);
      this.lineBuf = d.createBuffer({ size: this.lineCap * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    if (changed || !this.bgGeom) {
      this.bgGeom = d.createBindGroup({ layout: this.bglGeom, entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: { buffer: this.vertBuf } },
        { binding: 2, resource: { buffer: this.nodeBuf } },
      ] });
    }
  }

  /** Pack every body's skin into one vertex/index buffer. */
  setBodies(bodies) {
    let nv = 0, ni = 0, nn = 0, nl = 0;
    for (const b of bodies) {
      nv += b.piece.mesh.pos.length / 3;
      ni += b.piece.mesh.index.length;
      nn += b.n;
      nl += b.L.edges.length;
    }
    this.ensureGeometryBuffers(nv, ni, nn, nl);
    const buf = new ArrayBuffer(nv * VTX_FLOATS * 4);
    const fv = new Float32Array(buf), uv = new Uint32Array(buf);
    const idx = new Uint32Array(ni);
    const lines = new Uint32Array(nl);
    let vo = 0, io = 0, no = 0, lo = 0;
    bodies.forEach((b, slot) => {
      const m = b.piece.mesh;
      const n = m.pos.length / 3;
      for (let v = 0; v < n; v++) {
        const o = (vo + v) * VTX_FLOATS;
        fv[o] = m.pos[v * 3]; fv[o + 1] = m.pos[v * 3 + 1]; fv[o + 2] = m.pos[v * 3 + 2]; fv[o + 3] = slot;
        fv[o + 4] = m.nrm[v * 3]; fv[o + 5] = m.nrm[v * 3 + 1]; fv[o + 6] = m.nrm[v * 3 + 2]; fv[o + 7] = 0;
        for (let q = 0; q < 4; q++) { uv[o + 8 + q] = m.embTet[v * 4 + q] + no; fv[o + 12 + q] = m.embBary[v * 4 + q]; }
        for (let r = 0; r < 3; r++) {
          fv[o + 16 + r * 4] = m.embDm[v * 9 + r * 3];
          fv[o + 17 + r * 4] = m.embDm[v * 9 + r * 3 + 1];
          fv[o + 18 + r * 4] = m.embDm[v * 9 + r * 3 + 2];
          fv[o + 19 + r * 4] = 0;
        }
      }
      for (let i = 0; i < m.index.length; i++) idx[io + i] = m.index[i] + vo;
      const E = b.L.edges;
      for (let i = 0; i < E.length; i++) lines[lo + i] = E[i] + no;
      b.nodeOffset = no;
      vo += n; io += m.index.length; no += b.n; lo += E.length;
    });
    const q = this.device.queue;
    q.writeBuffer(this.vertBuf, 0, buf);
    q.writeBuffer(this.indexBuf, 0, idx);
    if (nl) q.writeBuffer(this.lineBuf, 0, lines);
    this.indexCount = ni;
    this.lineCount = nl;
    this.nodeCount = nn;
  }

  updateNodes(bodies) {
    const D = this.nodeData;
    for (const b of bodies) {
      const o = b.nodeOffset * 4, x = b.x;
      for (let i = 0; i < b.n; i++) {
        D[o + i * 4] = x[i * 3]; D[o + i * 4 + 1] = x[i * 3 + 1]; D[o + i * 4 + 2] = x[i * 3 + 2]; D[o + i * 4 + 3] = 1;
      }
    }
    this.device.queue.writeBuffer(this.nodeBuf, 0, D, 0, this.nodeCount * 4);
  }

  setKnifeMesh(data) {
    this.knifeVB = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.knifeVB, 0, data);
    this.knifeVerts = data.length / 7;
  }

  // ---- per frame ----------------------------------------------------------------------
  /**
   * s: { camera:{viewProj, invViewProj, pos}, light:{dir, intensity}, time, variety, anatomy, pips(Float32Array 4*2*16), showMesh, knife:{model}|null }
   */
  render(s) {
    const d = this.device, w = this.width, h = this.height;
    const F = this.frameData;
    F.set(s.camera.viewProj, 0);
    F.set(s.camera.invViewProj, 16);
    // light: orthographic from the key direction
    const L = s.light.dir;
    const center = [0, 0.8, 0];
    const eye = [center[0] + L[0] * 12, center[1] + L[1] * 12, center[2] + L[2] * 12];
    const lview = m4.lookAt(eye, center, Math.abs(L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
    const lproj = m4.ortho(-5, 5, -5, 5, 1, 24);
    F.set(m4.mul(lproj, lview), 32);
    const hview = m4.lookAt([0, 6, 0], [0, 0, 0], [0, 0, -1]);
    F.set(m4.mul(m4.ortho(-5, 5, -5, 5, 0, 6), hview), 48);
    F.set([s.camera.pos[0], s.camera.pos[1], s.camera.pos[2], s.time], 64);
    F.set([L[0], L[1], L[2], s.light.intensity], 68);
    F.set([w, h, 1 / w, 1 / h], 72);
    F.set([s.showMesh ? 1 : 0, s.frame, 23, SHADOW_SIZE], 76);
    const V = s.variety;
    const put4 = (o, a) => F.set([a[0], a[1], a[2], 0], o);
    put4(80, V.zestAbs); put4(84, V.pithAbs); put4(88, V.memAbs); put4(92, V.fleshAbs); put4(96, V.fleshAbs2);
    put4(100, V.glow); put4(104, V.stem); put4(108, V.blush); put4(112, V.shadowTint);
    const A = s.anatomy;
    for (let k = 0; k < SEGMENTS; k++) F.set([A.walls[k].base, A.walls[k].bow, A.walls[k].wander, A.walls[k].phase], 116 + k * 4);
    F.set(s.pips, 116 + SEGMENTS * 4);
    const bo = 116 + SEGMENTS * 4 + PIP_COUNT * 8;
    for (let i = 0; i < 8; i++) F.set(A.bubbles[i] || [0, 0, 0, 0], bo + i * 4);
    d.queue.writeBuffer(this.frameBuf, 0, F);
    d.queue.writeBuffer(this.postBuf, 0, new Float32Array([s.exposure ?? 1, this.srgbOut ? 1 : 0, s.time % 100, 0]));
    if (s.knife) d.queue.writeBuffer(this.knifeBuf, 0, s.knife.model);

    const enc = d.createCommandEncoder();
    const drawPieces = (pass) => {
      if (!this.indexCount) return;
      pass.setBindGroup(0, this.bgGeom);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      pass.drawIndexed(this.indexCount);
    };
    // shadow map
    {
      const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setPipeline(this.pShadow); drawPieces(pass); pass.end();
    }
    // height map for contact AO
    {
      const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.heightTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      pass.setPipeline(this.pHeight); drawPieces(pass); pass.end();
    }
    // back faces -> thickness
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.backTex.createView(), clearValue: { r: 1e4, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: this.backDepthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.pBack); drawPieces(pass); pass.end();
    }
    // studio
    {
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.sceneTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pStudio);
      pass.setBindGroup(0, this.bgGeom);
      pass.setBindGroup(1, this.bgStudio);
      pass.draw(3);
      pass.end();
    }
    // main
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.hdrTex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.pBlit);
      pass.setBindGroup(0, this.bgBlit);
      pass.draw(3);
      if (this.indexCount) {
        pass.setPipeline(this.pJelly);
        pass.setBindGroup(1, this.bgMain);
        drawPieces(pass);
      }
      if (s.knife && this.knifeVB) {
        pass.setPipeline(this.pKnife);
        pass.setBindGroup(0, this.bgGeom);
        pass.setBindGroup(1, this.bgKnife);
        pass.setVertexBuffer(0, this.knifeVB);
        pass.draw(this.knifeVerts);
      }
      if (s.showMesh && this.lineCount) {
        pass.setPipeline(this.pLines);
        pass.setBindGroup(0, this.bgGeom);
        pass.setIndexBuffer(this.lineBuf, 'uint32');
        pass.drawIndexed(this.lineCount);
      }
      pass.end();
    }
    // post
    {
      const target = this._captureTex ? this._captureTex.createView() : this.context.getCurrentTexture().createView();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.pPost);
      pass.setBindGroup(0, this.bgPost);
      pass.draw(3);
      pass.end();
    }
    if (this._captureTex) {
      const bpr = Math.ceil((w * 4) / 256) * 256;
      this._captureBuf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: this._captureTex }, { buffer: this._captureBuf, bytesPerRow: bpr }, [w, h]);
      this._captureBpr = bpr;
    }
    d.queue.submit([enc.finish()]);
  }

  /** Debug helper: render one frame offscreen and return a PNG data URL. */
  async capture(state) {
    const w = this.width, h = this.height;
    this._captureTex = this.device.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.render(state);
    const buf = this._captureBuf, bpr = this._captureBpr;
    this._captureTex.destroy();
    this._captureTex = null;
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
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

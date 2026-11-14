// Concept-map graph helpers: cycle detection, topological order, layers, and a
// small layered (Sugiyama-style) layout for the dashboard.

// concepts: [{ id, prerequisites: [] }]. Edges run prerequisite -> concept.
// Unknown prerequisites are ignored here (check reports them separately).
export function findCycles(concepts) {
  const ids = new Set(concepts.map((c) => c.id));
  const prereqs = new Map(concepts.map((c) => [c.id, (c.prerequisites ?? []).filter((p) => ids.has(p))]));
  const state = new Map(); // 0 = unvisited, 1 = on stack, 2 = done
  const stack = [];
  const cycles = [];
  const seen = new Set();
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const p of prereqs.get(id) ?? []) {
      const st = state.get(p) ?? 0;
      if (st === 0) visit(p);
      else if (st === 1) {
        // Cycle found: from p back up the stack to id. Report in prerequisite order.
        const loop = stack.slice(stack.indexOf(p)).reverse();
        const key = [...loop].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...loop, loop[0]]);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const c of concepts) if ((state.get(c.id) ?? 0) === 0) visit(c.id);
  return cycles;
}

// Stable topological order (Kahn), ties broken by original map order.
// Concepts caught in a cycle are appended at the end in map order.
export function topoOrder(concepts) {
  const ids = concepts.map((c) => c.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const children = new Map(ids.map((id) => [id, []]));
  for (const c of concepts) {
    for (const p of c.prerequisites ?? []) {
      if (!index.has(p)) continue;
      indeg.set(c.id, indeg.get(c.id) + 1);
      children.get(p).push(c.id);
    }
  }
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const out = [];
  while (ready.length) {
    ready.sort((a, b) => index.get(a) - index.get(b));
    const id = ready.shift();
    out.push(id);
    for (const ch of children.get(id)) {
      indeg.set(ch, indeg.get(ch) - 1);
      if (indeg.get(ch) === 0) ready.push(ch);
    }
  }
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

// Layer = length of the longest prerequisite chain below the concept (roots = 0).
export function layers(concepts) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const memo = new Map();
  const depth = (id, guard = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (guard.has(id)) return 0; // cycle: check reports it
    guard.add(id);
    const ps = (byId.get(id)?.prerequisites ?? []).filter((p) => byId.has(p));
    const d = ps.length ? 1 + Math.max(...ps.map((p) => depth(p, guard))) : 0;
    guard.delete(id);
    memo.set(id, d);
    return d;
  };
  const out = {};
  for (const c of concepts) out[c.id] = depth(c.id);
  return out;
}

// Layered layout with dummy nodes on long edges and barycentre ordering.
// Returns positions for real nodes and a list of edge polylines.
export function layoutDag(concepts, { nodeW = 168, nodeH = 58, gapX = 20, gapY = 64, dummyW = 16, sweeps = 12 } = {}) {
  const layerOf = layers(concepts);
  const ids = concepts.map((c) => c.id);
  const known = new Set(ids);
  const nodes = new Map(); // id -> { id, layer, dummy }
  for (const id of ids) nodes.set(id, { id, layer: layerOf[id], dummy: false });
  const segments = []; // [from, to] between adjacent layers
  const chains = []; // one per real edge: list of node ids from prerequisite to concept
  let dummyCount = 0;
  for (const c of concepts) {
    for (const p of c.prerequisites ?? []) {
      if (!known.has(p)) continue;
      const chain = [p];
      let prev = p;
      for (let l = layerOf[p] + 1; l < layerOf[c.id]; l++) {
        const d = `__d${dummyCount++}`;
        nodes.set(d, { id: d, layer: l, dummy: true });
        segments.push([prev, d]);
        chain.push(d);
        prev = d;
      }
      segments.push([prev, c.id]);
      chain.push(c.id);
      chains.push({ from: p, to: c.id, chain });
    }
  }
  const maxLayer = Math.max(0, ...[...nodes.values()].map((n) => n.layer));
  const rows = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes.values()) rows[n.layer].push(n.id);
  const up = new Map([...nodes.keys()].map((k) => [k, []]));
  const down = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const [a, b] of segments) {
    down.get(a).push(b);
    up.get(b).push(a);
  }
  const pos = new Map();
  const reindex = () => rows.forEach((row) => row.forEach((id, i) => pos.set(id, i)));
  reindex();
  const bary = (id, neighbours) => {
    const ns = neighbours.get(id);
    if (!ns.length) return pos.get(id);
    return ns.reduce((s, n) => s + pos.get(n), 0) / ns.length;
  };
  for (let s = 0; s < sweeps; s++) {
    const downward = s % 2 === 0;
    const order = downward ? rows.map((_, i) => i).slice(1) : rows.map((_, i) => i).reverse().slice(1);
    for (const l of order) {
      const nb = downward ? up : down;
      const keyed = rows[l].map((id, i) => ({ id, k: bary(id, nb), i }));
      keyed.sort((a, b) => a.k - b.k || a.i - b.i);
      rows[l] = keyed.map((x) => x.id);
      rows[l].forEach((id, i) => pos.set(id, i));
    }
  }
  // Coordinates: each row centred on the widest row.
  const widthOf = (id) => (nodes.get(id).dummy ? dummyW : nodeW);
  const rowWidth = (row) => row.reduce((s, id) => s + widthOf(id), 0) + gapX * Math.max(0, row.length - 1);
  const totalW = Math.max(nodeW, ...rows.map(rowWidth));
  const xy = new Map();
  rows.forEach((row, l) => {
    let x = (totalW - rowWidth(row)) / 2;
    for (const id of row) {
      const w = widthOf(id);
      xy.set(id, { x, y: l * (nodeH + gapY), w, h: nodes.get(id).dummy ? 0 : nodeH, cx: x + w / 2 });
      x += w + gapX;
    }
  });
  const placed = ids.map((id) => ({ id, layer: layerOf[id], ...xy.get(id) }));
  const edges = chains.map(({ from, to, chain }) => {
    const pts = [];
    chain.forEach((id, i) => {
      const p = xy.get(id);
      if (i === 0) pts.push({ x: p.cx, y: p.y + p.h });
      else if (i === chain.length - 1) pts.push({ x: p.cx, y: p.y });
      else pts.push({ x: p.cx, y: p.y }, { x: p.cx, y: p.y + nodeH }); // pass straight through the row
    });
    return { from, to, points: pts };
  });
  return { width: totalW, height: (maxLayer + 1) * (nodeH + gapY) - gapY, nodes: placed, edges, layers: maxLayer + 1 };
}

// Smooth SVG path through polyline points with vertical tangents at each point.
export function edgePath(points) {
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x) {
      d += ` L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      continue;
    }
    const my = (a.y + b.y) / 2;
    d += ` C${a.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

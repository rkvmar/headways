const ICON_W = 24;
const ICON_H = 26;
const ICON_W2 = ICON_W / 2;
const ICON_H2 = ICON_H / 2;

interface VehicleData {
	unique_id: string;
	lat: number;
	lon: number;
	backgroundColor: string;
	routeNumber: string;
	routeTooltip: string;
	agencyId: number;
}

interface AnimState {
	fromLat: number;
	fromLon: number;
	toLat: number;
	toLon: number;
	start: number;
}

// ponytail: L.Layer needs leaflet imported at module level which breaks SSR.
// Accept L as a param, use L.Layer.extend() to get a proper instanceof.
//
// Canvas is inside mapPane at z-index 450 (below marker-pane 600, above
// overlay-pane 400) so Leaflet markers render on top. Each frame we offset
// the canvas by the negative of the map-pane translate so it visually
// covers the container at (0,0). Drawing uses latLngToContainerPoint.
// pointer-events:none on canvas so map drag is unaffected; clicks go through
// a capture-phase listener on the container for vehicle hit detection.
export function createVehicleCanvasLayer(L: any) {
	return L.Layer.extend({
		_canvas: undefined as HTMLCanvasElement | undefined,
		_ctx: undefined as CanvasRenderingContext2D | undefined,
		_vehicles: [] as VehicleData[],
		_animating: new Map<string, AnimState>(),
		_raf: undefined as number | undefined,
		_moveRaf: undefined as number | undefined,
		_running: false,
		_onClickCallback: null as ((id: string) => void) | null,
		_mouseDownX: 0,
		_mouseDownY: 0,

		onAdd(map: any) {
			const container = map.getContainer();
			const mapPane = map.getPane('mapPane');
			const pr = window.devicePixelRatio || 1;

			const canvas = document.createElement('canvas');
			canvas.className = 'leaflet-canvas-icon-layer leaflet-layer leaflet-interactive';
			canvas.style.position = 'absolute';
			canvas.style.top = '0';
			canvas.style.left = '0';
			canvas.style.pointerEvents = 'none';
			canvas.style.zIndex = '450';

			const w = container.clientWidth;
			const h = container.clientHeight;
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
			canvas.width = w * pr;
			canvas.height = h * pr;

			mapPane.appendChild(canvas);

			this._canvas = canvas;
			this._ctx = canvas.getContext('2d')!;
			this._tick = this._tick.bind(this);
			this._scheduleRedraw = this._scheduleRedraw.bind(this);
			this._handleClick = this._handleClick.bind(this);
			this._handleMouseMove = this._handleMouseMove.bind(this);
			this._handleMouseDown = this._handleMouseDown.bind(this);

			container.addEventListener('mousedown', this._handleMouseDown);
			container.addEventListener('click', this._handleClick, true);
			container.addEventListener('mousemove', this._handleMouseMove);

			map.on('move zoom', this._scheduleRedraw, this);
			map.on('zoomend resize', this._onResize, this);
			this._onResize();
			this._draw();
		},

		onRemove(_map: any) {
			this._running = false;
			if (this._raf !== undefined) {
				cancelAnimationFrame(this._raf);
				this._raf = undefined;
			}
			if (this._moveRaf !== undefined) {
				cancelAnimationFrame(this._moveRaf);
				this._moveRaf = undefined;
			}
			if (this._canvas) {
				const container = this._map?.getContainer();
				if (container) {
					container.removeEventListener('mousedown', this._handleMouseDown);
					container.removeEventListener('click', this._handleClick, true);
					container.removeEventListener('mousemove', this._handleMouseMove);
				}
				this._canvas.remove();
				this._canvas = undefined;
				this._ctx = undefined;
			}
		},

		onClick(cb: (id: string) => void) {
			this._onClickCallback = cb;
			return this;
		},

		setVehicles(vehicles: VehicleData[]) {
			const prev = new Map<string, VehicleData>();
			for (const v of this._vehicles) prev.set(v.unique_id, v);

			const now = performance.now();
			for (const v of vehicles) {
				const old = prev.get(v.unique_id);
				if (old && (old.lat !== v.lat || old.lon !== v.lon)) {
					const existing = this._animating.get(v.unique_id);
					const fromLat = existing ? this._interpolate(existing.fromLat, existing.toLat, existing.start, now) : old.lat;
					const fromLon = existing ? this._interpolate(existing.fromLon, existing.toLon, existing.start, now) : old.lon;
					this._animating.set(v.unique_id, { fromLat, fromLon, toLat: v.lat, toLon: v.lon, start: now });
				}
			}

			this._vehicles = vehicles;
			if (this._animating.size > 0) {
				this._startLoop();
			} else {
				this._draw();
			}
		},

		_hitTest(mx: number, my: number): string | null {
			if (!this._canvas || !this._map) return null;
			const map = this._map;
			const bounds = map.getBounds();

			for (let i = this._vehicles.length - 1; i >= 0; i--) {
				const v = this._vehicles[i];
				if (!bounds.contains(L.latLng(v.lat, v.lon))) continue;
				const p = map.latLngToContainerPoint([v.lat, v.lon]);
				if (mx >= p.x - ICON_W2 && mx <= p.x + ICON_W2 && my >= p.y - ICON_H2 && my <= p.y + ICON_H2) {
					return v.unique_id;
				}
			}
			return null;
		},

		_handleMouseDown(e: MouseEvent) {
			this._mouseDownX = e.clientX;
			this._mouseDownY = e.clientY;
		},

		_handleClick(e: MouseEvent) {
			if (!this._canvas || !this._onClickCallback) return;
			const dx = e.clientX - this._mouseDownX;
			const dy = e.clientY - this._mouseDownY;
			if (dx * dx + dy * dy > 25) return;
			if ((e.target as HTMLElement)?.closest('.stop-marker')) return;
			const rect = this._canvas.getBoundingClientRect();
			const id = this._hitTest(e.clientX - rect.left, e.clientY - rect.top);
			if (id) {
				e.stopPropagation();
				this._onClickCallback(id);
			}
		},

		_handleMouseMove(e: MouseEvent) {
			if (!this._canvas || !this._map) return;
			const rect = this._canvas.getBoundingClientRect();
			const id = this._hitTest(e.clientX - rect.left, e.clientY - rect.top);
			this._map.getContainer().style.cursor = id ? 'pointer' : '';
		},

		_scheduleRedraw() {
			if (this._moveRaf === undefined) {
				this._moveRaf = requestAnimationFrame(() => {
					this._moveRaf = undefined;
					this._draw();
					if (this._animating.size > 0) {
						this._startLoop();
					}
				});
			}
		},

		_onResize() {
			if (!this._canvas || !this._map) return;
			const container = this._map.getContainer();
			const pr = window.devicePixelRatio || 1;
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (this._canvas.width !== w * pr || this._canvas.height !== h * pr) {
				this._canvas.style.width = w + 'px';
				this._canvas.style.height = h + 'px';
				this._canvas.width = w * pr;
				this._canvas.height = h * pr;
			}
			this._draw();
		},

		_startLoop() {
			if (!this._running) {
				this._running = true;
				this._raf = requestAnimationFrame(this._tick);
			}
		},

		_tick() {
			if (!this._running) return;
			this._raf = undefined;
			const now = performance.now();
			const ANIM_MS = 2500;
			let anyActive = false;

			for (const [id, a] of this._animating) {
				if (now - a.start >= ANIM_MS) {
					this._animating.delete(id);
				} else {
					anyActive = true;
				}
			}

			this._draw();

			if (anyActive) {
				this._raf = requestAnimationFrame(this._tick);
			} else {
				this._running = false;
			}
		},

		_interpolate(from: number, to: number, start: number, now: number) {
			const t = Math.min((now - start) / 2500, 1);
			const e = 1 - (1 - t) * (1 - t);
			return from + (to - from) * e;
		},

		_draw() {
			if (!this._ctx || !this._map || !this._canvas) return;
			const map = this._map;
			const ctx = this._ctx;
			const bounds = map.getBounds();
			const pr = window.devicePixelRatio || 1;
			const now = performance.now();
			const ANIM_MS = 2500;

			const mapPane = map.getPane('mapPane');
			const panePos = mapPane?._leaflet_pos || { x: 0, y: 0 };
			this._canvas.style.left = -panePos.x + 'px';
			this._canvas.style.top = -panePos.y + 'px';

			const cw = this._canvas.width;
			const ch = this._canvas.height;
			ctx.clearRect(0, 0, cw, ch);
			ctx.save();
			ctx.scale(pr, pr);

			for (const v of this._vehicles) {
				let lat = v.lat;
				let lon = v.lon;
				const a = this._animating.get(v.unique_id);
				if (a) {
					const t = Math.min((now - a.start) / ANIM_MS, 1);
					const e = 1 - (1 - t) * (1 - t);
					lat = a.fromLat + (a.toLat - a.fromLat) * e;
					lon = a.fromLon + (a.toLon - a.fromLon) * e;
				}

				const ll = L.latLng(lat, lon);
				if (!bounds.contains(ll)) continue;

				const p = map.latLngToContainerPoint(ll);
				const rx = p.x - ICON_W2;
				const ry = p.y - ICON_H2;

				ctx.fillStyle = v.backgroundColor;
				ctx.fillRect(rx, ry, ICON_W, ICON_H);

				ctx.strokeStyle = 'white';
				ctx.lineWidth = 2;
				ctx.strokeRect(rx + 1, ry + 1, ICON_W - 2, ICON_H - 2);

				const text = v.routeNumber;
				const fontSize = text.length > 3 ? 7 : 10;
				ctx.font = `bold ${fontSize}px Helvetica, sans-serif`;
				ctx.fillStyle = 'white';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(text, p.x, p.y + 1);
			}

			ctx.restore();
		}
	});
}

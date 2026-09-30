"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Grip, Maximize2, MessageCircle, Minus, RotateCcw } from "lucide-react";

export function FloatingChat({ children, busy }: { children: ReactNode; busy: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const clamp = (x: number, y: number) => {
    const el = panel.current, parent = el?.parentElement;
    return { x: Math.max(8, Math.min(x, (parent?.clientWidth ?? 500) - (el?.offsetWidth ?? 380) - 8)), y: Math.max(8, Math.min(y, (parent?.clientHeight ?? 700) - (el?.offsetHeight ?? 500) - 8)) };
  };
  useEffect(() => {
    const observer = new ResizeObserver(() => setPosition((old) => old ? clamp(old.x, old.y) : null));
    if (panel.current) observer.observe(panel.current);
    if (panel.current?.parentElement) observer.observe(panel.current.parentElement);
    return () => observer.disconnect();
  }, []);
  return <div ref={panel} className={`floating-chat ${collapsed ? "collapsed" : ""} ${dragging ? "dragging" : ""}`} style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}>
    <header className="floating-title">
      <button className="chat-drag" aria-label="Mover conversa; use as setas do teclado" title="Arraste para mover · setas também movem" onKeyDown={(event) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault(); const el = panel.current!;
        setPosition(clamp(el.offsetLeft + (event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0), el.offsetTop + (event.key === "ArrowDown" ? 24 : event.key === "ArrowUp" ? -24 : 0)));
      }} onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId); const el = panel.current!;
        drag.current = { x: event.clientX, y: event.clientY, px: el.offsetLeft, py: el.offsetTop }; setDragging(true);
      }} onPointerMove={(event) => { if (drag.current) setPosition(clamp(drag.current.px + event.clientX - drag.current.x, drag.current.py + event.clientY - drag.current.y)); }} onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
        <Grip size={15} /><span className={`fc-indicator ${busy ? "busy" : ""}`} /><span><strong>Gudman</strong><small>{busy ? "Processando sua mensagem" : "Canal de conversa"}</small></span>
      </button>
      <button aria-label="Restaurar posição da conversa" title="Restaurar posição" onClick={() => setPosition(null)}><RotateCcw size={14} /></button>
      <button aria-label={collapsed ? "Expandir conversa" : "Recolher conversa"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Maximize2 size={15} /> : <Minus size={15} />}</button>
    </header>
    <div className="floating-content" inert={collapsed}>{children}</div>
    {collapsed && <button className="fc-reopen" onClick={() => setCollapsed(false)}><MessageCircle size={15} /> Abrir conversa {busy && <span>· em andamento</span>}</button>}
  </div>;
}

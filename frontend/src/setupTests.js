import '@testing-library/jest-dom'

// jsdom no implementa CanvasRenderingContext2D (getContext devuelve null), y
// el renderer Canvas de Leaflet (preferCanvas + circleMarker en MapViewer)
// lo necesita tanto para dibujar como en el teardown (map.remove() →
// _removePath sobre un contexto inexistente → TypeError). Este stub devuelve
// un contexto "que acepta todo": cualquier método es un no-op, cualquier
// asignación de propiedad se acepta, y los pocos métodos que deben devolver
// un objeto (measureText, getImageData, gradientes) devuelven formas mínimas.
const noop = () => {};
const contextStub = (canvas) =>
  new Proxy(
    { canvas },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getImageData')
          return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === 'createImageData')
          return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern')
          return () => ({ addColorStop: noop });
        return noop;
      },
      set() {
        return true;
      },
    },
  );

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return contextStub(this);
  };
}

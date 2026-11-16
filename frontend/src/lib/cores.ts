export function hexParaRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminância relativa (WCAG 2.x). */
export function luminancia(hex: string) {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Escolhe texto claro ou escuro, o que tiver mais contraste sobre a cor dada. */
export function textoSobre(hex: string) {
  const l = luminancia(hex);
  return contraste(l, 1) >= contraste(l, luminancia('#13191B')) ? '#FFFFFF' : '#13191B';
}

export const corValida = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);

/**
 * Aplica a cor primária escolhida pelo administrador sobre o CoreUI:
 * variáveis globais, botões primários, foco de campos e checkboxes.
 */
export function aplicarCorPrimaria(hex: string) {
  if (!corValida(hex)) return;
  const [r, g, b] = hexParaRgb(hex);
  const texto = textoSobre(hex);
  const css = `
:root, :root[data-coreui-theme] {
  --bi-primary: ${hex};
  --bi-primary-rgb: ${r}, ${g}, ${b};
  --bi-on-primary: ${texto};
  --cui-primary: ${hex};
  --cui-primary-rgb: ${r}, ${g}, ${b};
  --cui-link-color: ${hex};
  --cui-link-color-rgb: ${r}, ${g}, ${b};
  --cui-link-hover-color: color-mix(in srgb, ${hex} 78%, #000);
}
:root[data-coreui-theme="dark"] {
  --cui-link-color: color-mix(in srgb, ${hex} 65%, #fff);
  --cui-link-hover-color: color-mix(in srgb, ${hex} 50%, #fff);
}

.btn-primary, [data-coreui-theme] .btn-primary, :root[data-coreui-theme] .btn-primary {
  --cui-btn-color: ${texto};
  --cui-btn-bg: ${hex};
  --cui-btn-border-color: ${hex};
  --cui-btn-hover-color: ${texto};
  --cui-btn-hover-bg: color-mix(in srgb, ${hex} 86%, #000);
  --cui-btn-hover-border-color: color-mix(in srgb, ${hex} 86%, #000);
  --cui-btn-active-color: ${texto};
  --cui-btn-active-bg: color-mix(in srgb, ${hex} 76%, #000);
  --cui-btn-active-border-color: color-mix(in srgb, ${hex} 76%, #000);
  --cui-btn-disabled-color: ${texto};
  --cui-btn-disabled-bg: ${hex};
  --cui-btn-disabled-border-color: ${hex};
  --cui-btn-focus-shadow-rgb: ${r}, ${g}, ${b};
}
.form-control:focus, .form-select:focus, .form-check-input:focus,
.form-password:focus-within, .form-multi-select.show, .form-multi-select.focus,
.form-multi-select:focus-within, .picker.show .form-control {
  border-color: color-mix(in srgb, ${hex} 55%, #fff);
  box-shadow: 0 0 0 .25rem rgba(${r}, ${g}, ${b}, .25);
}
.form-check-input:checked, [data-coreui-theme] .form-check-input:checked { background-color: ${hex}; border-color: ${hex}; }
`;
  let el = document.getElementById('bi-cor-primaria') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'bi-cor-primaria';
    document.head.appendChild(el);
  }
  el.textContent = css;
}

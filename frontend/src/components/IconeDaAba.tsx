import { useEffect } from 'react';
import { useAparencia } from '../contexts/AparenciaContext';
import { useTema } from '../contexts/TemaContext';
import { faviconDoTema } from '../types';

const tipoDoArquivo = (url: string) =>
  url.endsWith('.svg') ? 'image/svg+xml' : url.endsWith('.ico') ? 'image/x-icon' : url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

/**
 * Ícone da aba do navegador (favicon), conforme o tema da ferramenta:
 * o enviado em Aparência para o tema (ou o do outro tema, se só um foi enviado) ou o padrão.
 */
export function IconeDaAba() {
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const url = faviconDoTema(aparencia, tema) ?? '/favicon.svg';

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
    link.type = tipoDoArquivo(url);
  }, [url]);

  return null;
}

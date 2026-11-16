import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Tema } from '../types';

/* Google Identity Services (script oficial do Google, carregado só quando o login com Google está ligado) */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; hd?: string; use_fedcm_for_prompt?: boolean }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let carregando: Promise<void> | null = null;
function carregarScript() {
  carregando ??= new Promise<void>((ok, falha) => {
    if (window.google?.accounts?.id) return ok();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      carregando = null;
      falha(new Error('script'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

let configCache: Promise<{ clientId: string | null; dominio: string | null }> | null = null;

interface Props {
  tema: Tema;
  /** Recebe o ID token emitido pelo Google */
  onCredencial: (credencial: string) => void;
  desabilitado?: boolean;
}

/**
 * Botão "Fazer login com o Google". Só aparece quando a API informa um GOOGLE_CLIENT_ID.
 * Quem valida o token e confere se o e-mail está cadastrado é a API.
 */
export function BotaoGoogle({ tema, onCredencial, desabilitado }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [dominio, setDominio] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const callback = useRef(onCredencial);
  callback.current = onCredencial;

  useEffect(() => {
    configCache ??= api.get('/auth/google/config').then((r) => r.data).catch(() => ({ clientId: null, dominio: null }));
    configCache.then((c) => {
      setClientId(c.clientId);
      setDominio(c.dominio);
    });
  }, []);

  useEffect(() => {
    if (!clientId || !area.current) return;
    let ativo = true;
    carregarScript()
      .then(() => {
        if (!ativo || !area.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (r) => callback.current(r.credential),
          ...(dominio ? { hd: dominio } : {}),
        });
        area.current.innerHTML = '';
        window.google.accounts.id.renderButton(area.current, {
          type: 'standard',
          theme: tema === 'escuro' ? 'filled_black' : 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'pt-BR',
          width: Math.min(400, area.current.clientWidth || 320),
        });
      })
      .catch(() => ativo && setFalhou(true));
    return () => {
      ativo = false;
    };
  }, [clientId, dominio, tema]);

  if (!clientId) return null;

  return (
    <div className="login-google">
      <div className="login-separador" role="separator">
        <span>ou</span>
      </div>
      {falhou ? (
        <p className="small text-body-secondary text-center mb-0">Não foi possível carregar o login com Google. Verifique o acesso a accounts.google.com.</p>
      ) : (
        <div ref={area} className={`login-google-botao${desabilitado ? ' desabilitado' : ''}`} aria-busy={desabilitado} />
      )}
    </div>
  );
}

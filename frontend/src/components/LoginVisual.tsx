import type { CSSProperties, ReactNode } from 'react';
import { textoSobre } from '../lib/cores';
import { logoDoTema, type Aparencia, type Tema } from '../types';
import { SkylineArte } from './SkylineArte';

interface Props {
  aparencia: Aparencia;
  tema: Tema;
  /** Formulário (login, troca de senha...) */
  children: ReactNode;
  /** Elemento no canto superior direito, como o botão de tema */
  acoes?: ReactNode;
}

/**
 * Moldura da tela de login. É usada pela página real e pela pré-visualização
 * em Configurações › Aparência, para que as duas sejam sempre idênticas.
 */
export function LoginVisual({ aparencia, tema, children, acoes }: Props) {
  const fundo = tema === 'escuro' ? aparencia.corFundoLoginEscuro : aparencia.corFundoLogin;
  const estilo = {
    '--login-bg': fundo,
    '--login-ink': textoSobre(fundo),
  } as CSSProperties;

  const arte = (
    <div className="login-arte">
      {aparencia.imagemFundoUrl ? (
        <img src={aparencia.imagemFundoUrl} alt="" className="login-arte-imagem" />
      ) : (
        <SkylineArte className="login-arte-skyline" />
      )}
      <span className="login-arte-legenda">{aparencia.nomeSistema}</span>
    </div>
  );

  const cabecalho = (
    <>
      {logoDoTema(aparencia, tema) ? (
        <img src={logoDoTema(aparencia, tema)!} alt={aparencia.nomeSistema} className="login-logo" />
      ) : (
        <span className="login-marca">{aparencia.nomeSistema}</span>
      )}
      <h1 className="login-titulo">{aparencia.tituloLogin}</h1>
      {aparencia.subtituloLogin && <p className="login-subtitulo">{aparencia.subtituloLogin}</p>}
    </>
  );

  if (aparencia.layoutLogin === 'centralizado') {
    return (
      <div className="login-raiz" style={estilo}>
        <div className={`login-tela centralizado ${aparencia.imagemFundoUrl ? 'com-imagem' : ''}`}>
          {aparencia.imagemFundoUrl ? (
            <img src={aparencia.imagemFundoUrl} alt="" className="login-fundo-imagem" />
          ) : (
            <SkylineArte className="login-fundo-skyline" />
          )}
          {acoes && <div className="login-acoes">{acoes}</div>}
          <main className="login-cartao">
            {cabecalho}
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="login-raiz" style={estilo}>
      <div className="login-tela dividido">
        {arte}
        <main className="login-painel">
          {acoes && <div className="login-acoes">{acoes}</div>}
          <div className="login-form-area">
            {cabecalho}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

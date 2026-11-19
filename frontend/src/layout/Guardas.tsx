import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CSpinner } from '@coreui/react-pro';
import { useAuth } from '../contexts/AuthContext';
import { ehAdmin, ehDesenvolvedor } from '../types';

export function CarregandoTela() {
  return (
    <div className="carregando-tela" role="status" aria-live="polite">
      <CSpinner color="primary" />
      <span className="visually-hidden">Carregando</span>
    </div>
  );
}

/**
 * Exige sessão. Antes de liberar o sistema, resolve as pendências do cadastro:
 * 1º troca de senha obrigatória, 2º e-mail (cadastros antigos sem e-mail).
 */
export function RequerLogin({ children }: { children: ReactNode }) {
  const { usuario, iniciando } = useAuth();
  const location = useLocation();
  if (iniciando) return <CarregandoTela />;
  if (!usuario) return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  if (usuario.trocaSenhaObrigatoria && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  if (!usuario.trocaSenhaObrigatoria && usuario.emailPendente && location.pathname !== '/completar-cadastro') {
    return <Navigate to="/completar-cadastro" replace />;
  }
  return <>{children}</>;
}

/** Gestor ou Desenvolvedor. */
export function RequerAdmin({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  if (!ehAdmin(usuario)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** SQL, conexões e tabelas: só Desenvolvedor. */
export function RequerDesenvolvedor({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  if (!ehDesenvolvedor(usuario)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

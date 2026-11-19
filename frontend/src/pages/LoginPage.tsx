import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CAlert, CForm, CFormInput, CFormLabel, CLoadingButton, CPasswordInput } from '@coreui/react-pro';
import { lerMotivoSaida, mensagemDeErro } from '../api/client';
import { AlternarTema } from '../components/AlternarTema';
import { LoginVisual } from '../components/LoginVisual';
import { BotaoGoogle } from '../components/BotaoGoogle';
import { useAparencia } from '../contexts/AparenciaContext';
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';

export function LoginPage() {
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const { usuario, entrar, entrarComGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destino = (location.state as { de?: string } | null)?.de ?? '/';

  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [motivoSaida] = useState(lerMotivoSaida);

  if (usuario) return <Navigate to={usuario.trocaSenhaObrigatoria ? '/trocar-senha' : usuario.emailPendente ? '/completar-cadastro' : destino} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!login.trim() || !senha) {
      setErro('Informe usuário e senha para entrar.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const u = await entrar(login.trim(), senha);
      navigate(u.trocaSenhaObrigatoria ? '/trocar-senha' : u.emailPendente ? '/completar-cadastro' : destino, { replace: true });
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível entrar. Tente novamente.'));
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  async function comGoogle(credencial: string) {
    setErro(null);
    setEnviando(true);
    try {
      const u = await entrarComGoogle(credencial);
      navigate(u.trocaSenhaObrigatoria ? '/trocar-senha' : u.emailPendente ? '/completar-cadastro' : destino, { replace: true });
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível entrar com o Google.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <LoginVisual aparencia={aparencia} tema={tema} acoes={<AlternarTema />}>
      <FormularioLogin
        login={login}
        senha={senha}
        erro={erro}
        enviando={enviando}
        onLogin={setLogin}
        onSenha={setSenha}
        onSubmit={enviar}
        aviso={erro ? null : motivoSaida}
        extra={<BotaoGoogle tema={tema} onCredencial={comGoogle} desabilitado={enviando} />}
      />
    </LoginVisual>
  );
}

interface FormProps {
  login: string;
  senha: string;
  erro?: string | null;
  enviando?: boolean;
  onLogin?: (v: string) => void;
  onSenha?: (v: string) => void;
  onSubmit?: (e: FormEvent) => void;
  /** Aviso informativo (ex.: sessão encerrada à meia-noite) */
  aviso?: string | null;
  /** Conteúdo depois do botão Entrar (login com Google) */
  extra?: ReactNode;
}

/** Exportado separado para a pré-visualização reaproveitar o mesmo formulário. */
export function FormularioLogin({ login, senha, erro, enviando, onLogin, onSenha, onSubmit, aviso, extra }: FormProps) {
  return (
    <CForm className="login-form" onSubmit={onSubmit} noValidate>
      {aviso && (
        <CAlert color="info" className="py-2 small" role="status">
          {aviso}
        </CAlert>
      )}
      {erro && (
        <CAlert color="danger" className="py-2 small" role="alert">
          {erro}
        </CAlert>
      )}
      <div className="mb-3">
        <CFormLabel htmlFor="login-usuario">Usuário</CFormLabel>
        <CFormInput
          id="login-usuario"
          size="lg"
          autoComplete="username"
          autoFocus
          value={login}
          onChange={(e) => onLogin?.(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <CFormLabel htmlFor="login-senha">Senha</CFormLabel>
        <CPasswordInput
          id="login-senha"
          size="lg"
          autoComplete="current-password"
          ariaLabelToggler="Mostrar ou ocultar a senha"
          value={senha}
          onChange={(e) => onSenha?.(e.target.value)}
        />
      </div>
      <CLoadingButton type="submit" color="primary" size="lg" className="w-100" loading={enviando} disabled={enviando}>
        Entrar
      </CLoadingButton>
      {extra}
      <p className="login-ajuda">Esqueceu a senha? Peça ao administrador do sistema para redefini-la.</p>
    </CForm>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CAlert, CButton, CForm, CFormInput, CFormLabel, CFormText, CLoadingButton } from '@coreui/react-pro';
import { api, mensagemDeErro } from '../api/client';
import { AlternarTema } from '../components/AlternarTema';
import { LoginVisual } from '../components/LoginVisual';
import { useAparencia } from '../contexts/AparenciaContext';
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';
import type { Usuario } from '../types';

/** Cadastros antigos sem e-mail: o e-mail passou a ser obrigatório. */
export function CompletarCadastroPage() {
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const { usuario, atualizarUsuario, sair } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { data } = await api.post<{ usuario: Usuario }>('/auth/completar-cadastro', { email });
      atualizarUsuario(data.usuario);
      navigate('/', { replace: true, state: { aviso: 'E-mail salvo.' } });
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const tela = {
    ...aparencia,
    tituloLogin: 'Informe seu e-mail',
    subtituloLogin: `Olá, ${usuario?.nome}. O e-mail agora é obrigatório: ele é usado para contato e para recuperar a senha.`,
  };

  return (
    <LoginVisual aparencia={tela} tema={tema} acoes={<AlternarTema />}>
      <CForm className="login-form" onSubmit={enviar} noValidate>
        {erro && (
          <CAlert color="danger" className="py-2 small" role="alert">
            {erro}
          </CAlert>
        )}
        <div className="mb-4">
          <CFormLabel htmlFor="completar-email">E-mail</CFormLabel>
          <CFormInput
            id="completar-email"
            type="email"
            size="lg"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <CFormText>Use o e-mail da empresa.</CFormText>
        </div>
        <CLoadingButton type="submit" color="primary" size="lg" className="w-100" loading={enviando} disabled={enviando}>
          Salvar e continuar
        </CLoadingButton>
        <CButton color="link" className="w-100 mt-2" onClick={() => sair()}>
          Sair
        </CButton>
      </CForm>
    </LoginVisual>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CAlert, CButton, CForm, CFormLabel, CFormText, CLoadingButton, CPasswordInput } from '@coreui/react-pro';
import { api, mensagemDeErro } from '../api/client';
import { AlternarTema } from '../components/AlternarTema';
import { LoginVisual } from '../components/LoginVisual';
import { useAparencia } from '../contexts/AparenciaContext';
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';
import type { Usuario } from '../types';

export function TrocarSenhaPage() {
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const { usuario, atualizarUsuario, sair } = useAuth();
  const navigate = useNavigate();
  const obrigatoria = !!usuario?.trocaSenhaObrigatoria;

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nova !== confirmacao) {
      setErro('A confirmação não confere com a nova senha.');
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      const { data } = await api.post<{ usuario: Usuario }>('/auth/trocar-senha', {
        senhaAtual: atual,
        novaSenha: nova,
      });
      atualizarUsuario(data.usuario);
      navigate(data.usuario.emailPendente ? '/completar-cadastro' : '/', { replace: true, state: { aviso: 'Senha alterada.' } });
    } catch (err) {
      setErro(mensagemDeErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const aparenciaTela = {
    ...aparencia,
    tituloLogin: obrigatoria ? 'Defina sua senha' : 'Trocar senha',
    subtituloLogin: obrigatoria
      ? `Olá, ${usuario?.nome}. Este é seu primeiro acesso: crie uma senha só sua para continuar.`
      : 'Informe a senha atual e escolha a nova.',
  };

  return (
    <LoginVisual aparencia={aparenciaTela} tema={tema} acoes={<AlternarTema />}>
      <CForm className="login-form" onSubmit={enviar} noValidate>
        {erro && (
          <CAlert color="danger" className="py-2 small" role="alert">
            {erro}
          </CAlert>
        )}
        <div className="mb-3">
          <CFormLabel htmlFor="senha-atual">Senha atual</CFormLabel>
          <CPasswordInput
            id="senha-atual"
            autoComplete="current-password"
            autoFocus
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <CFormLabel htmlFor="senha-nova">Nova senha</CFormLabel>
          <CPasswordInput
            id="senha-nova"
            autoComplete="new-password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
          />
          <CFormText>Pelo menos 8 caracteres, com letras e números.</CFormText>
        </div>
        <div className="mb-4">
          <CFormLabel htmlFor="senha-confirmacao">Confirme a nova senha</CFormLabel>
          <CPasswordInput
            id="senha-confirmacao"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
        </div>
        <CLoadingButton type="submit" color="primary" className="w-100" loading={enviando} disabled={enviando}>
          Salvar nova senha
        </CLoadingButton>
        <CButton
          color="link"
          className="w-100 mt-2"
          onClick={() => (obrigatoria ? sair() : navigate(-1))}
        >
          {obrigatoria ? 'Sair' : 'Voltar'}
        </CButton>
      </CForm>
    </LoginVisual>
  );
}

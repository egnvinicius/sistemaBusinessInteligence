import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AparenciaProvider } from './contexts/AparenciaContext';
import { AuthProvider } from './contexts/AuthContext';
import { TemaProvider } from './contexts/TemaContext';
import { IconeDaAba } from './components/IconeDaAba';
import { AppLayout } from './layout/AppLayout';
import { RequerAdmin, RequerDesenvolvedor, RequerLogin } from './layout/Guardas';
import { AparenciaPage } from './pages/AparenciaPage';
import { GruposPage } from './pages/admin/GruposPage';
import { MenuPage } from './pages/admin/MenuPage';
import { UsuariosPage } from './pages/admin/UsuariosPage';
import { PainelPage } from './pages/PainelPage';
import { CompletarCadastroPage } from './pages/CompletarCadastroPage';
import { AcaoPage } from './pages/dados/AcaoPage';
import { AcoesPage } from './pages/dados/AcoesPage';
import { ConexoesPage } from './pages/dados/ConexoesPage';
import { ConsolePage } from './pages/dados/ConsolePage';
import { ConsultaPage } from './pages/construcao/ConsultaPage';
import { ConsultasPage } from './pages/construcao/ConsultasPage';
import { FiltrosPage } from './pages/construcao/FiltrosPage';
import { CubosPage } from './pages/construcao/CubosPage';
import { AnalisesPage } from './pages/analises/AnalisesPage';
import { AnalisePage } from './pages/analises/AnalisePage';
import { AnaliseVerPage } from './pages/analises/AnaliseVerPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { ImagensPage } from './pages/dados/ImagensPage';
import { MontarPainelPage } from './pages/admin/MontarPainelPage';
import { TarefaPage } from './pages/dados/TarefaPage';
import { TarefasPage } from './pages/dados/TarefasPage';
import { InicioPage } from './pages/InicioPage';
import { LoginPage } from './pages/LoginPage';
import { TrocarSenhaPage } from './pages/TrocarSenhaPage';

export default function App() {
  return (
    <AparenciaProvider>
      <AuthProvider>
        <TemaProvider>
          <IconeDaAba />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/trocar-senha"
                element={
                  <RequerLogin>
                    <TrocarSenhaPage />
                  </RequerLogin>
                }
              />
              <Route
                path="/completar-cadastro"
                element={
                  <RequerLogin>
                    <CompletarCadastroPage />
                  </RequerLogin>
                }
              />
              <Route
                element={
                  <RequerLogin>
                    <AppLayout />
                  </RequerLogin>
                }
              >
                <Route index element={<InicioPage />} />
                <Route path="painel/:id" element={<PainelPage />} />
                <Route
                  path="dados/tarefas"
                  element={
                    <RequerAdmin>
                      <TarefasPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="dados/imagens"
                  element={
                    <RequerAdmin>
                      <ImagensPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="dados/tarefas/:id"
                  element={
                    <RequerAdmin>
                      <TarefaPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="dados/acoes"
                  element={
                    <RequerDesenvolvedor>
                      <AcoesPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="dados/acoes/:id"
                  element={
                    <RequerDesenvolvedor>
                      <AcaoPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="dados/console"
                  element={
                    <RequerDesenvolvedor>
                      <ConsolePage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="dados/conexoes"
                  element={
                    <RequerDesenvolvedor>
                      <ConexoesPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="construcao/consultas"
                  element={
                    <RequerDesenvolvedor>
                      <ConsultasPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="construcao/consultas/:id"
                  element={
                    <RequerDesenvolvedor>
                      <ConsultaPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route path="configuracoes" element={<ConfiguracoesPage />} />
                <Route path="analises" element={<AnalisesPage />} />
                <Route path="analises/nova" element={<AnalisePage key="nova" />} />
                <Route path="analises/:id" element={<AnalisePage />} />
                <Route path="analises/:id/ver" element={<AnaliseVerPage />} />
                <Route
                  path="construcao/cubos"
                  element={
                    <RequerAdmin>
                      <CubosPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="construcao/filtros"
                  element={
                    <RequerDesenvolvedor>
                      <FiltrosPage />
                    </RequerDesenvolvedor>
                  }
                />
                <Route
                  path="admin/paineis/:id/montar"
                  element={
                    <RequerAdmin>
                      <MontarPainelPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="admin/usuarios"
                  element={
                    <RequerAdmin>
                      <UsuariosPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="admin/grupos"
                  element={
                    <RequerAdmin>
                      <GruposPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="admin/menu"
                  element={
                    <RequerAdmin>
                      <MenuPage />
                    </RequerAdmin>
                  }
                />
                <Route
                  path="configuracoes/aparencia"
                  element={
                    <RequerAdmin>
                      <AparenciaPage />
                    </RequerAdmin>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </TemaProvider>
      </AuthProvider>
    </AparenciaProvider>
  );
}

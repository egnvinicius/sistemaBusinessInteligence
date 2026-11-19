import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import CIcon from '@coreui/icons-react';
import {
  cilBrush,
  cilChartLine,
  cilChevronLeft,
  cilChevronRight,
  cilCode,
  cilFilter,
  cilGroup,
  cilHome,
  cilImage,
  cilLayers,
  cilLightbulb,
  cilListRich,
  cilPeople,
  cilSettings,
  cilStorage,
  cilSync,
  cilTerminal,
  cilX,
} from '@coreui/icons';
import { useAparencia } from '../contexts/AparenciaContext';
import { useAuth } from '../contexts/AuthContext';
import { useMenu } from '../contexts/MenuContext';
import { useTema } from '../contexts/TemaContext';
import { iconeDoMenu } from '../lib/icones';
import { ehAdmin, ehDesenvolvedor, faviconDoTema, logoDoTema, type MenuGrupo, type MenuSubgrupo } from '../types';

/* =========================================================
   Barra lateral
   - Aberta: ícone + nome; recolhida: só ícones, com o nome ao passar o mouse.
   - Grupos do menu e as áreas de gestão abrem um painel ao lado (não abaixo).
   - Atualização de dados, Construção de painéis e Administração ficam na base.
   - No celular vira gaveta; os painéis laterais abrem por cima dela, com "Voltar".
   ========================================================= */

interface Link {
  para: string;
  icone: string[];
  rotulo: string;
}

interface Props {
  recolhida: boolean;
  onRecolher: () => void;
  /** Gaveta do celular aberta */
  aberta: boolean;
  onFechar: () => void;
}

const CHAVE_LEMBRAR = 'bi_barra_recolhida';
export const lerRecolhida = () => {
  try {
    return localStorage.getItem(CHAVE_LEMBRAR) === '1';
  } catch {
    return false;
  }
};
export const gravarRecolhida = (v: boolean) => {
  try {
    localStorage.setItem(CHAVE_LEMBRAR, v ? '1' : '0');
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
};

const MOVEL = '(max-width: 991.98px)';
function useMovel() {
  const [movel, setMovel] = useState(() => window.matchMedia(MOVEL).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOVEL);
    const h = () => setMovel(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return movel;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

/** Algum painel desta subárvore é o que está aberto? */
const contemPainel = (s: MenuSubgrupo, id: number): boolean => s.paineis.some((p) => p.id === id) || s.subgrupos.some((f) => contemPainel(f, id));

/** Subgrupos achatados com o caminho ("Frota › Pneus"), cada um com os painéis dele. */
function secoesDoGrupo(g: MenuGrupo) {
  const saida: { id: number; caminho: string; paineis: { id: number; nome: string; privado?: boolean }[] }[] = [];
  const visitar = (s: MenuSubgrupo, prefixo: string) => {
    const caminho = prefixo ? `${prefixo} › ${s.nome}` : s.nome;
    if (s.paineis.length) saida.push({ id: s.id, caminho, paineis: s.paineis });
    s.subgrupos.forEach((f) => visitar(f, caminho));
  };
  g.subgrupos.forEach((s) => visitar(s, ''));
  return saida;
}

export function BarraLateral({ recolhida, onRecolher, aberta, onFechar }: Props) {
  const { usuario } = useAuth();
  const { aparencia } = useAparencia();
  const { tema } = useTema();
  const { menu, carregando } = useMenu();
  const { pathname } = useLocation();
  const movel = useMovel();
  const estreita = recolhida && !movel;
  const painelAtual = Number(pathname.match(/^\/painel\/(\d+)/)?.[1] ?? 0);

  // Painel lateral aberto (um por vez) e o botão que o abriu
  const [lateral, setLateral] = useState<{ id: string; gatilho: HTMLElement } | null>(null);
  // Nome do item na barra recolhida
  const [dica, setDica] = useState<{ texto: string; top: number } | null>(null);

  const fecharLateral = useCallback((devolverFoco = false) => {
    setLateral((l) => {
      if (devolverFoco) l?.gatilho.focus();
      return null;
    });
  }, []);

  // Navegou: fecha o painel lateral (e a gaveta, no celular)
  useEffect(() => {
    setLateral(null);
    setDica(null);
    if (movel) onFechar();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!movel) setLateral(null);
  }, [movel, recolhida]);

  const alternar = (id: string, gatilho: HTMLElement) => {
    setDica(null);
    setLateral((l) => (l?.id === id ? null : { id, gatilho }));
  };

  const mostrarDica = (texto: string, el: HTMLElement) => {
    if (!estreita) return;
    const r = el.getBoundingClientRect();
    setDica({ texto, top: r.top + r.height / 2 });
  };
  const esconderDica = () => setDica(null);

  if (!usuario) return null;

  const admin = ehAdmin(usuario);
  const dev = ehDesenvolvedor(usuario);

  /* Áreas de gestão, na base da barra */
  const gestao: { id: string; rotulo: string; icone: string[]; itens: Link[] }[] = [];
  if (admin) {
    gestao.push({
      id: 'dados',
      rotulo: 'Atualização de dados',
      icone: cilSync,
      itens: [
        { para: '/dados/tarefas', icone: cilSync, rotulo: 'Tarefas' },
        { para: '/dados/imagens', icone: cilImage, rotulo: 'Imagens' },
        ...(dev
          ? [
              { para: '/dados/acoes', icone: cilCode, rotulo: 'Ações (SQL)' },
              { para: '/dados/conexoes', icone: cilStorage, rotulo: 'Conexões' },
              { para: '/dados/console', icone: cilTerminal, rotulo: 'Console SQL' },
            ]
          : []),
      ],
    });
    if (dev) {
      gestao.push({
        id: 'construcao',
        rotulo: 'Construção de painéis',
        icone: cilLayers,
        itens: [
          { para: '/construcao/consultas', icone: cilChartLine, rotulo: 'Consultas de painel' },
          { para: '/construcao/filtros', icone: cilFilter, rotulo: 'Filtros e listas' },
          { para: '/construcao/cubos', icone: cilLayers, rotulo: 'Cubos' },
        ],
      });
    }
    gestao.push({
      id: 'admin',
      rotulo: 'Administração',
      icone: cilSettings,
      itens: [
        { para: '/admin/usuarios', icone: cilPeople, rotulo: 'Usuários' },
        { para: '/admin/grupos', icone: cilGroup, rotulo: 'Grupos de acesso' },
        { para: '/admin/menu', icone: cilListRich, rotulo: 'Menu e painéis' },
        { para: '/configuracoes/aparencia', icone: cilBrush, rotulo: 'Aparência' },
        ...(!dev ? [{ para: '/construcao/cubos', icone: cilLayers, rotulo: 'Cubos e uso da IA' }] : []),
      ],
    });
  }

  const ativoNaGestao = (itens: Link[]) => itens.some((i) => pathname === i.para || pathname.startsWith(`${i.para}/`));

  /** Item com painel lateral (grupo do menu ou área de gestão). */
  // Funções (e não componentes) para os itens não serem recriados a cada render: o hover e o foco ficam estáveis
  const itemLateral = ({ id, rotulo, icone, ativo }: { id: string; rotulo: string; icone: string[]; ativo: boolean }) => {
    const aberto = lateral?.id === id;
    return (
      <li key={id}>
        <button
          type="button"
          className={`barra-item${ativo ? ' ativo' : ''}${aberto ? ' aberto' : ''}`}
          aria-expanded={aberto}
          aria-haspopup="true"
          aria-controls={aberto ? 'barra-lateral-painel' : undefined}
          onClick={(e) => alternar(id, e.currentTarget)}
          onMouseEnter={(e) => {
            mostrarDica(rotulo, e.currentTarget);
            // Com um painel aberto, passar por outro item troca o painel (como um menu de aplicativo)
            if (lateral && lateral.id !== id && !movel) setLateral({ id, gatilho: e.currentTarget });
          }}
          onMouseLeave={esconderDica}
          onFocus={(e) => mostrarDica(rotulo, e.currentTarget)}
          onBlur={esconderDica}
        >
          <CIcon icon={icone} className="barra-icone" />
          <span className="barra-rotulo">{rotulo}</span>
          <CIcon icon={cilChevronRight} className="barra-seta" />
        </button>
      </li>
    );
  };

  const itemLink = ({ para, icone, rotulo, fim }: Link & { fim?: boolean }) => (
    <li key={para}>
      <NavLink
        to={para}
        end={fim}
        className={({ isActive }) => `barra-item${isActive ? ' ativo' : ''}`}
        onMouseEnter={(e) => mostrarDica(rotulo, e.currentTarget)}
        onMouseLeave={esconderDica}
        onFocus={(e) => mostrarDica(rotulo, e.currentTarget)}
        onBlur={esconderDica}
      >
        <CIcon icon={icone} className="barra-icone" />
        <span className="barra-rotulo">{rotulo}</span>
      </NavLink>
    </li>
  );

  const logo = logoDoTema(aparencia, tema);
  const grupoAberto = lateral?.id.startsWith('g') ? menu.find((g) => `g${g.id}` === lateral.id) : undefined;
  const gestaoAberta = gestao.find((x) => x.id === lateral?.id);

  return (
    <>
      {movel && aberta && <div className="barra-fundo" onClick={onFechar} aria-hidden="true" />}
      <aside
        className={`barra${estreita ? ' recolhida' : ''}${movel ? ' movel' : ''}${movel && aberta ? ' aberta' : ''}`}
        aria-label="Menu"
        {...(movel && !aberta ? { inert: '' as unknown as boolean } : {})}
      >
        <div className="barra-topo">
          <NavLink to="/" className="barra-marca" aria-label={`${aparencia.nomeSistema}: início`}>
            {estreita ? (
              faviconDoTema(aparencia, tema) ? (
                <img src={faviconDoTema(aparencia, tema)!} alt="" className="barra-marca-icone" />
              ) : (
                <span className="barra-monograma" aria-hidden="true">
                  {aparencia.nomeSistema.trim().slice(0, 2).toUpperCase()}
                </span>
              )
            ) : logo ? (
              <img src={logo} alt={aparencia.nomeSistema} className="barra-logo" />
            ) : (
              <span className="barra-nome">{aparencia.nomeSistema}</span>
            )}
          </NavLink>
          {movel ? (
            <button type="button" className="barra-recolher" onClick={onFechar} aria-label="Fechar o menu">
              <CIcon icon={cilX} />
            </button>
          ) : (
            <button
              type="button"
              className="barra-recolher"
              onClick={onRecolher}
              aria-label={recolhida ? 'Expandir o menu' : 'Recolher o menu'}
              aria-pressed={recolhida}
              onMouseEnter={(e) => mostrarDica('Expandir o menu', e.currentTarget)}
              onMouseLeave={esconderDica}
            >
              <IconeBarra />
            </button>
          )}
        </div>

        <nav className="barra-nav" aria-label="Painéis e análises">
          <ul>
            {itemLink({ para: '/', icone: cilHome, rotulo: 'Início', fim: true })}
          </ul>
          <p className="barra-secao">Painéis</p>
          <ul>
            {carregando ? null : menu.length === 0 ? (
              <li className="barra-vazio">Nenhum painel liberado</li>
            ) : (
              menu.map((g) => (
                itemLateral({ id: `g${g.id}`, rotulo: g.nome, icone: iconeDoMenu(g.icone), ativo: g.subgrupos.some((s) => contemPainel(s, painelAtual)) })
              ))
            )}
          </ul>
          <p className="barra-secao">Análises</p>
          <ul>
            {itemLink({ para: '/analises', icone: cilLightbulb, rotulo: 'Minhas análises' })}
          </ul>
        </nav>

        {gestao.length > 0 && (
          <nav className="barra-base" aria-label="Gestão">
            <ul>
              {gestao.map((x) => (
                itemLateral({ id: x.id, rotulo: x.rotulo, icone: x.icone, ativo: ativoNaGestao(x.itens) })
              ))}
            </ul>
          </nav>
        )}
      </aside>

      {lateral && (grupoAberto || gestaoAberta) && (
        <PainelLateral
          gatilho={lateral.gatilho}
          movel={movel}
          titulo={grupoAberto?.nome ?? gestaoAberta!.rotulo}
          onFechar={fecharLateral}
        >
          {grupoAberto ? (
            <ConteudoGrupo g={grupoAberto} />
          ) : (
            <ul className="lateral-lista">
              {gestaoAberta!.itens.map((i) => (
                <li key={i.para}>
                  <NavLink to={i.para} className={({ isActive }) => `lateral-link${isActive ? ' ativo' : ''}`}>
                    <CIcon icon={i.icone} className="lateral-icone" />
                    {i.rotulo}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </PainelLateral>
      )}

      {dica && estreita && !lateral &&
        createPortal(
          <div className="barra-dica" role="tooltip" style={{ top: dica.top }}>
            {dica.texto}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Painéis de um grupo do menu, por subgrupo, com busca quando são muitos. */
function ConteudoGrupo({ g }: { g: MenuGrupo }) {
  const secoes = useMemo(() => secoesDoGrupo(g), [g]);
  const total = secoes.reduce((n, s) => n + s.paineis.length, 0);
  const [busca, setBusca] = useState('');
  const b = semAcento(busca.trim());
  const filtradas = b
    ? secoes.map((s) => ({ ...s, paineis: s.paineis.filter((p) => semAcento(`${s.caminho} ${p.nome}`).includes(b)) })).filter((s) => s.paineis.length)
    : secoes;

  return (
    <>
      {total > 8 && (
        <div className="lateral-busca">
          <input type="search" className="form-control form-control-sm" placeholder="Buscar painel" aria-label={`Buscar painel em ${g.nome}`} value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}
      {filtradas.map((s) => (
        <section key={s.id} className="lateral-secao" aria-label={s.caminho}>
          <h3>{s.caminho}</h3>
          <ul className="lateral-lista">
            {s.paineis.map((p) => (
              <li key={p.id}>
                <NavLink to={`/painel/${p.id}`} className={({ isActive }) => `lateral-link${isActive ? ' ativo' : ''}`}>
                  <span className="lateral-ponto" aria-hidden="true" />
                  {p.nome}
                  {p.privado && <span className="lateral-privado">só você</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {filtradas.length === 0 && <p className="lateral-vazio">{b ? 'Nenhum painel com esse nome.' : 'Nenhum painel neste grupo.'}</p>}
    </>
  );
}

/**
 * Painel que abre ao lado da barra, alinhado ao item que o abriu.
 * Esc fecha e devolve o foco; clique fora fecha.
 */
function PainelLateral({ gatilho, movel, titulo, onFechar, children }: { gatilho: HTMLElement; movel: boolean; titulo: string; onFechar: (devolverFoco?: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Posição: ao lado da barra, na altura do item; sobe se não couber embaixo
  useLayoutEffect(() => {
    if (movel || !ref.current) return;
    const r = gatilho.getBoundingClientRect();
    const barra = gatilho.closest('.barra')?.getBoundingClientRect();
    const altura = ref.current.offsetHeight;
    const top = Math.max(8, Math.min(r.top - 8, window.innerHeight - altura - 8));
    setPos({ top, left: (barra?.right ?? r.right) + 8 });
  }, [gatilho, movel, titulo, children]);

  useEffect(() => {
    // Foco no primeiro link, para quem navega pelo teclado
    const primeiro = ref.current?.querySelector<HTMLElement>('input, a');
    primeiro?.focus({ preventScroll: true });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar(true);
    };
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (ref.current?.contains(alvo) || gatilho.contains(alvo)) return;
      // Clique em outro item com painel: ele mesmo troca
      if ((alvo as HTMLElement).closest?.('.barra-item[aria-haspopup]')) return;
      onFechar();
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('mousedown', fora);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('mousedown', fora);
    };
  }, [gatilho, onFechar, titulo]);

  return (
    <div
      ref={ref}
      id="barra-lateral-painel"
      className={`barra-painel${movel ? ' movel' : ''}`}
      role="region"
      aria-label={titulo}
      style={movel ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="barra-painel-cabeca">
        {movel && (
          <button type="button" className="barra-painel-voltar" onClick={() => onFechar(true)} aria-label="Voltar ao menu">
            <CIcon icon={cilChevronLeft} />
          </button>
        )}
        <h2>{titulo}</h2>
      </div>
      <div className="barra-painel-corpo">{children}</div>
    </div>
  );
}

/** Ícone de "barra lateral" (retângulo com uma coluna), igual nos dois estados. */
function IconeBarra() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

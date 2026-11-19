import CodeMirror from '@uiw/react-codemirror';
import { MSSQL, PostgreSQL, sql } from '@codemirror/lang-sql';
import { useTema } from '../contexts/TemaContext';

interface Props {
  id: string;
  valor: string;
  onChange: (v: string) => void;
  dialeto: 'sqlserver' | 'postgres';
  altura?: string;
  rotuloAria: string;
  somenteLeitura?: boolean;
}

/** Editor de SQL com destaque de sintaxe, numeração de linhas e tema claro/escuro. */
export function EditorSql({ id, valor, onChange, dialeto, altura = '320px', rotuloAria, somenteLeitura }: Props) {
  const { tema } = useTema();
  return (
    <div className="editor-sql" id={id}>
      <CodeMirror
        value={valor}
        height={altura}
        theme={tema === 'escuro' ? 'dark' : 'light'}
        extensions={[sql({ dialect: dialeto === 'sqlserver' ? MSSQL : PostgreSQL, upperCaseKeywords: true })]}
        onChange={onChange}
        editable={!somenteLeitura}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true }}
        aria-label={rotuloAria}
      />
    </div>
  );
}

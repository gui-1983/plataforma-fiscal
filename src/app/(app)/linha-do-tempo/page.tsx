const CRONOGRAMA = [
  { ano: "2026", titulo: "Ano de teste", texto: "CBS 0,9% e IBS 0,1% destacados no documento fiscal, com dispensa de recolhimento para quem cumpre as obrigações acessórias.", marco: "Rejeição da NF-e sem o grupo IBS/CBS desde 03/08/2026 para o regime regular.", corrente: true },
  { ano: "2027", titulo: "CBS em cobrança", texto: "PIS e Cofins extintos, IPI reduzido a zero salvo exceções. Imposto Seletivo entra em vigor.", marco: "Alíquota de referência pendente de fixação por resolução do Senado." },
  { ano: "2028", titulo: "Consolidação", texto: "CBS em regime normal. ICMS e ISS ainda integrais." },
  { ano: "2029", titulo: "Início da rampa do IBS", texto: "IBS a 10% da alíquota plena. ICMS e ISS caem para 90%.", marco: "Benefícios de ICMS começam a decair." },
  { ano: "2030", titulo: "Rampa", texto: "IBS a 20%. ICMS e ISS a 80%." },
  { ano: "2031", titulo: "Rampa", texto: "IBS a 30%. ICMS e ISS a 70%." },
  { ano: "2032", titulo: "Último ano de convivência", texto: "IBS a 40%. ICMS e ISS a 60%.", marco: "Fim dos benefícios de ICMS ao término do ano." },
  { ano: "2033", titulo: "Regime pleno", texto: "ICMS e ISS extintos. IBS e CBS plenos." },
];

export default function LinhaDoTempo() {
  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Módulo 1 · Entenda a reforma</div>
          <h1>Linha do tempo</h1>
          <p>Cada ano tem regra própria, e é por isso que o motor exige a data do fato gerador. Uma nota de 2026 nunca é validada com a regra de 2029.</p>
        </div>
      </div>

      <div className="cartao" style={{ padding: "4px 20px 8px" }}>
        {CRONOGRAMA.map((a) => (
          <div className={"ano" + (a.corrente ? " corrente" : "")} key={a.ano}>
            <div className="n">{a.ano}</div>
            <div>
              <h3>{a.titulo}</h3>
              <p>{a.texto}</p>
              {a.marco && <div className="marco">{a.marco}</div>}
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 14, maxWidth: "72ch" }}>
        O cronograma é dado configurável, não constante de código. As alíquotas de 2027 em diante dependem
        de fixação normativa e por isso não estão cadastradas com valor numérico.
      </p>
    </>
  );
}

"use client";
import { extrairChave } from "@/lib/nfe/chave";

/* ============================================================================
   OCR no navegador. Roda na máquina do usuário: não pesa a função serverless
   e o documento não trafega para um serviço de terceiros.

   Alvo único: a chave de acesso. Não tentamos ler valores nem itens — leitura
   errada de valor passaria despercebida; leitura errada de chave é rejeitada
   pelo dígito verificador.
   ========================================================================== */

type Progresso = (texto: string, pct?: number) => void;

/** Rasteriza as primeiras páginas do PDF. O DANFE traz a chave na página 1. */
async function pdfParaImagens(file: File, maxPaginas = 2, escala = 3): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let n = 1; n <= Math.min(doc.numPages, maxPaginas); n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
   await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

/** Aumenta contraste e binariza: OCR de documento escaneado melhora muito. */
function preparar(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const cinza = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = cinza > 165 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface ResultadoOcr {
  chave: string | null;
  invalida: string | null;
  texto: string;
}

export async function lerChavePorOcr(file: File, onProgresso?: Progresso): Promise<ResultadoOcr> {
  const { createWorker, PSM } = await import("tesseract.js");

  onProgresso?.("Preparando imagem…", 5);
  const imagens = /\.pdf$/i.test(file.name)
    ? (await pdfParaImagens(file)).map(preparar)
    : [file];

  onProgresso?.("Carregando o reconhecedor…", 15);
  const worker = await createWorker("por");

  // Só dígitos e espaço: reduz drasticamente a chance de confundir 0/O e 1/I.
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789 ",
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
  });

  let textoTotal = "";
  try {
    for (let i = 0; i < imagens.length; i++) {
      onProgresso?.(`Lendo página ${i + 1} de ${imagens.length}…`, 25 + i * 35);
      const { data } = await worker.recognize(imagens[i] as HTMLCanvasElement | File);
      textoTotal += "\n" + data.text;

      const parcial = extrairChave(textoTotal);
      if (parcial.chave) {
        onProgresso?.("Chave encontrada.", 100);
        await worker.terminate();
        return { ...parcial, texto: textoTotal };
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  onProgresso?.("Leitura concluída.", 100);
  return { ...extrairChave(textoTotal), texto: textoTotal };
}

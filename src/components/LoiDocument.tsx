import { LOI_BLOCKS, LOI_TITLE, LOI_VERSION } from '../legal/loi';

/** Public rendering of the Customer Letter of Intent. */
export default function LoiDocument() {
  return (
    <article>
      <h1 className="text-3xl font-bold tracking-tight text-black">{LOI_TITLE}</h1>
      <p className="mt-2 text-sm text-black/50">Version {LOI_VERSION} · Rukmer Inc.</p>
      <div className="mt-8 space-y-8 text-[15px] leading-7 text-black/80">
        {LOI_BLOCKS.map((block) => (
          <section key={block.heading || block.paragraphs[0]}>
            {block.heading && <h2 className="text-lg font-semibold text-black mb-2">{block.heading}</h2>}
            {block.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mb-3">{paragraph}</p>
            ))}
          </section>
        ))}
        <section>
          <p className="font-semibold text-black">Rukmer Inc.</p>
          <p>25 N New Jersey St</p>
          <p>Indianapolis, IN 46204</p>
          <p className="mt-4 font-semibold text-black">Customer</p>
          <p>Accepted electronically upon account creation.</p>
        </section>
      </div>
    </article>
  );
}

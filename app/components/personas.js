import { Icon } from './icons.js';

// Static marketing section: who TruthLens is for. No state, no props.
// Extracted from app/page.js so the home page stays readable; output is unchanged.
export function Personas() {
  return (
    <section className="home-section" data-audience>
      <p className="mock-kicker"><Icon name="users" />Purpose-Built Utility</p>
      <h2>Who uses TruthLens</h2>
      <div className="audience-top">
        <p className="home-body">TruthLens is for researchers and journalists who must check a claim before they publish or use it. Truth seekers, lifelong learners, students, and nonfiction readers use it too.</p>
        <aside className="audience-note"><strong>Same evidence for all.</strong><br />Truth seekers can test what they read. Conspiracy theorists can test their own ideas with the same evidence. Lifelong learners can follow a question. Nonfiction readers can check the excerpt in their hands.</aside>
      </div>
      <div className="audience-grid mock-personas">
        <article className="mock-persona">
          <picture><source srcSet="/mockup/img4.webp" type="image/webp" /><img className="mock-persona-img" src="/mockup/img4.jpg" alt="Investigative journalists reviewing verified documents" loading="lazy" decoding="async" width={640} height={400} /></picture>
          <span className="mock-persona-ic" data-audience-icon="journalists"><span className="material-symbols-outlined">newspaper</span></span><h3>Journalists</h3>
          <p>Check a claim before you publish. Open each source, cross-examine contradicting claims, and export the dossier for your story file.</p><p className="mock-workflow">Workflow: Newsroom Pre-Pub</p>
        </article>
        <article className="mock-persona">
          <picture><source srcSet="/mockup/researchers.webp" type="image/webp" /><img className="mock-persona-img" src="/mockup/researchers.jpg" alt="Researcher analyzing data on dual monitors in a lab" loading="lazy" decoding="async" width={640} height={400} /></picture>
          <span className="mock-persona-ic" data-audience-icon="researchers"><span className="material-symbols-outlined">biotech</span></span><h3>Researchers</h3>
          <p>Check a claim before you cite it. See evidence for and against side by side. Uncover exactly where the checkers split and what missing data could change the verdict.</p><p className="mock-workflow">Workflow: Literature Review</p>
        </article>
        <article className="mock-persona">
          <picture><source srcSet="/mockup/students.webp" type="image/webp" /><img className="mock-persona-img" src="/mockup/students.jpg" alt="Student studying an excerpt in a library" loading="lazy" decoding="async" width={640} height={400} /></picture>
          <span className="mock-persona-ic" data-audience-icon="students"><span className="material-symbols-outlined">menu_book</span></span><h3>Students</h3>
          <p>Check a claim before you put it in an essay. Read the quoted passages yourself instead of trusting a summary. Archive the report alongside your personal research notes.</p><p className="mock-workflow">Workflow: Academic Inquiry</p>
        </article>
      </div>
    </section>
  );
}

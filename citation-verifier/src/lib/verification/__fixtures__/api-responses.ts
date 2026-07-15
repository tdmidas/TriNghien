import { HttpResponse, http } from 'msw';

// MSW handlers reproducing the 2026-07-14 live-baseline behavior for the
// representative acceptance subset. Live reality encoded here:
// - Crossref/OpenAlex relevance search ALWAYS returns candidates (never
//   empty) — hallucinated entries are "answered but nothing same-paper".
// - maml matches via OpenAlex whose venue is "Proceedings of Machine
//   Learning Research" (not the bib booktitle).
// - eddm matches via Semantic Scholar with year 2005 (bib says 2006).

const UNRELATED_CROSSREF_ITEM = {
  DOI: '10.1000/unrelated.candidate',
  title: ['A Survey of Underwater Basket Weaving Techniques'],
  author: [{ given: 'Alice', family: 'Nobody' }],
  issued: { 'date-parts': [[2011]] },
  'container-title': ['Journal of Unrelated Studies'],
};

const ICARL_WORK = {
  DOI: '10.1109/cvpr.2017.587',
  title: ['iCaRL: Incremental Classifier and Representation Learning'],
  author: [
    { given: 'Sylvestre-Alvise', family: 'Rebuffi' },
    { given: 'Alexander', family: 'Kolesnikov' },
    { given: 'Georg', family: 'Sperl' },
    { given: 'Christoph H.', family: 'Lampert' },
  ],
  issued: { 'date-parts': [[2017]] },
  'container-title': ['2017 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'],
  ISSN: ['1063-6919'],
};

const EWC_WORK = {
  DOI: '10.1073/pnas.1611835114',
  title: ['Overcoming catastrophic forgetting in neural networks'],
  author: [
    { given: 'James', family: 'Kirkpatrick' },
    { given: 'Razvan', family: 'Pascanu' },
    { given: 'Neil', family: 'Rabinowitz' },
    { given: 'Joel', family: 'Veness' },
    { given: 'Guillaume', family: 'Desjardins' },
    { given: 'Andrei A.', family: 'Rusu' },
    { given: 'Kieran', family: 'Milan' },
    { given: 'John', family: 'Quan' },
    { given: 'Tiago', family: 'Ramalho' },
    { given: 'Agnieszka', family: 'Grabska-Barwinska' },
    { given: 'Demis', family: 'Hassabis' },
    { given: 'Claudia', family: 'Clopath' },
    { given: 'Dharshan', family: 'Kumaran' },
    { given: 'Raia', family: 'Hadsell' },
  ],
  issued: { 'date-parts': [[2017]] },
  'container-title': ['Proceedings of the National Academy of Sciences'],
  ISSN: ['0027-8424'],
};

const REPURPOSED_WORK = {
  DOI: '10.1234/repurposed.real.paper',
  title: ['Sedimentary Patterns of the Mekong Delta Estuary'],
  author: [{ given: 'Marie', family: 'Curie' }],
  issued: { 'date-parts': [[1998]] },
  'container-title': ['Marine Geology'],
};

const FOMAML_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1803.02999v3</id>
    <title>On First-Order Meta-Learning Algorithms</title>
    <published>2018-03-08T17:58:48Z</published>
    <author><name>Alex Nichol</name></author>
    <author><name>Joshua Achiam</name></author>
    <author><name>John Schulman</name></author>
  </entry>
</feed>`;

// doi.org handle API: fabricated DOI -> 100, real DOIs -> 1
const KNOWN_HANDLES = ['10.1109/cvpr.2017.587', '10.1073/pnas.1611835114', '10.1234/repurposed.real.paper'];

export const fixtureHandlers = [
  http.get('https://doi.org/api/handles/*', ({ request }) => {
    const doi = decodeURIComponent(new URL(request.url).pathname.replace('/api/handles/', ''));
    // Live behavior: a missing handle answers HTTP 404 WITH responseCode 100.
    return KNOWN_HANDLES.includes(doi.toLowerCase())
      ? HttpResponse.json({ responseCode: 1 })
      : HttpResponse.json({ responseCode: 100 }, { status: 404 });
  }),

  http.get('https://api.crossref.org/works/*', ({ request }) => {
    const doi = decodeURIComponent(
      new URL(request.url).pathname.replace('/works/', ''),
    ).toLowerCase();
    if (doi === '10.1109/cvpr.2017.587') return HttpResponse.json({ message: ICARL_WORK });
    if (doi === '10.1073/pnas.1611835114') return HttpResponse.json({ message: EWC_WORK });
    if (doi === '10.1234/repurposed.real.paper')
      return HttpResponse.json({ message: REPURPOSED_WORK });
    return new HttpResponse(null, { status: 404 });
  }),

  // Relevance search: always answers with SOME candidate (live behavior);
  // only maml-adjacent queries get a same-paper record — via OpenAlex below.
  http.get('https://api.crossref.org/works', () =>
    HttpResponse.json({ message: { items: [UNRELATED_CROSSREF_ITEM] } }),
  ),

  http.get('https://api.openalex.org/works', ({ request }) => {
    const filter = new URL(request.url).searchParams.get('filter') ?? '';
    if (/model-agnostic meta-learning/i.test(filter)) {
      return HttpResponse.json({
        results: [
          {
            display_name: 'Model-Agnostic Meta-Learning for Fast Adaptation of Deep Networks',
            publication_year: 2017,
            doi: 'https://doi.org/10.48550/arxiv.1703.03400',
            authorships: [
              { author: { display_name: 'Chelsea Finn' } },
              { author: { display_name: 'Pieter Abbeel' } },
              { author: { display_name: 'Sergey Levine' } },
            ],
            primary_location: {
              source: { display_name: 'Proceedings of Machine Learning Research' },
            },
          },
        ],
      });
    }
    return HttpResponse.json({ results: [] });
  }),

  http.get('https://api.semanticscholar.org/graph/v1/paper/search/match', ({ request }) => {
    const query = new URL(request.url).searchParams.get('query') ?? '';
    if (/early drift detection method/i.test(query)) {
      return HttpResponse.json({
        data: [
          {
            title: 'Early Drift Detection Method',
            year: 2005, // S2 records the workshop preprint year (bib says 2006)
            venue: 'International Workshop on Knowledge Discovery from Data Streams',
            authors: [
              { name: 'Manuel Baena-García' },
              { name: 'José del Campo-Ávila' },
              { name: 'Raúl Fidalgo-Merino' },
              { name: 'Albert Bifet' },
              { name: 'Ricard Gavaldà' },
              { name: 'Rafael Morales-Bueno' },
            ],
          },
        ],
      });
    }
    return new HttpResponse(null, { status: 404 });
  }),

  http.get('https://export.arxiv.org/api/query', () =>
    HttpResponse.text(FOMAML_ATOM, { headers: { 'Content-Type': 'application/atom+xml' } }),
  ),

  // DBLP: clean miss everywhere (its only job is blocking false NOT_FOUNDs;
  // the fakes must be clean misses for the acceptance verdicts to hold)
  http.get('https://dblp.org/search/publ/api', () =>
    HttpResponse.json({ result: { hits: {} } }),
  ),

  http.get('https://api.crossref.org/journals/*', ({ request }) => {
    const issn = new URL(request.url).pathname.replace('/journals/', '');
    return ['1063-6919', '0027-8424'].includes(issn)
      ? HttpResponse.json({})
      : new HttpResponse(null, { status: 404 });
  }),

  // URL liveness HEAD probes (paired with a dns mock in the test file)
  http.head('https://proceedings.mlr.press/*', () => new HttpResponse(null, { status: 200 })),
  http.head('https://arxiv.org/*', () => new HttpResponse(null, { status: 200 })),
];

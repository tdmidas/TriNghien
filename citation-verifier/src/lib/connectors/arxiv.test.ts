import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../vitest.setup';
import { arxivById } from './arxiv';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
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

// arXiv answers bad ids with an error entry that has no /abs/ id.
const ERROR_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format</id>
    <title>Error</title>
  </entry>
</feed>`;

describe('arxivById', () => {
  it('maps the Atom entry to a CanonicalRecord', async () => {
    server.use(
      http.get('https://export.arxiv.org/api/query', () =>
        HttpResponse.text(FEED, { headers: { 'Content-Type': 'application/atom+xml' } }),
      ),
    );
    const r = await arxivById('1803.02999');
    expect(r).toMatchObject({
      source: 'arxiv',
      title: 'On First-Order Meta-Learning Algorithms',
      authors: ['Alex Nichol', 'Joshua Achiam', 'John Schulman'],
      year: 2018,
    });
  });

  it('returns null for an error feed (id does not exist)', async () => {
    server.use(
      http.get('https://export.arxiv.org/api/query', () =>
        HttpResponse.text(ERROR_FEED, { headers: { 'Content-Type': 'application/atom+xml' } }),
      ),
    );
    expect(await arxivById('9999.99999')).toBeNull();
  });

  it('returns null on HTTP failure', async () => {
    server.use(
      http.get('https://export.arxiv.org/api/query', () => new HttpResponse(null, { status: 503 })),
    );
    expect(await arxivById('1803.02999')).toBeNull();
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCivitaiEarlyAccessInfo,
  extractRecommendedWeight,
  formatCivitaiHtmlDescription,
  isKrea2BaseModel,
  normalizeCivitaiData,
  parseCivitaiShareUrl,
  parseIdsFromCivitaiUrl,
} from '../src/server/services/civitai/civitaiHttpAndParse.ts';

describe('civitaiHttpAndParse pure parsers', () => {
  it('parses model IDs, version IDs, and domain from Civitai URLs', () => {
    const web = parseIdsFromCivitaiUrl('https://civitai.com/models/123456?modelVersionId=789012');
    assert.deepEqual(web, { modelId: '123456', versionId: '789012', domain: 'civitai.com' });

    const dl = parseIdsFromCivitaiUrl('https://civitai.red/api/download/models/998877');
    assert.deepEqual(dl, { modelId: null, versionId: '998877', domain: 'civitai.red' });

    assert.deepEqual(parseIdsFromCivitaiUrl('not-a-url'), {
      modelId: null,
      versionId: null,
      domain: null,
    });
  });

  it('parses Civitai share URLs strictly for /images/:id and /posts/:id', () => {
    const imgShare = parseCivitaiShareUrl('https://civitai.com/images/555111?period=Week');
    assert.equal(imgShare?.kind, 'image');
    assert.equal(imgShare?.id, 555111);
    assert.equal(imgShare?.domain, 'civitai.com');

    const postShare = parseCivitaiShareUrl('https://www.civitai.red/posts/444222');
    assert.equal(postShare?.kind, 'post');
    assert.equal(postShare?.id, 444222);
    assert.equal(postShare?.domain, 'civitai.red');

    assert.equal(parseCivitaiShareUrl('https://civitai.com/models/123'), null);
  });

  it('identifies Krea 2 base models while excluding Flux.1 Krea and SDXL', () => {
    assert.equal(isKrea2BaseModel('Krea 2'), true);
    assert.equal(isKrea2BaseModel('krea2 turbo'), true);
    assert.equal(isKrea2BaseModel('Flux.1 Krea'), false);
    assert.equal(isKrea2BaseModel('SDXL 1.0'), false);
  });

  it('extracts recommended LoRA weights from resources, prompts, and descriptions', () => {
    assert.equal(
      extractRecommendedWeight({
        id: 200,
        images: [{ meta: { civitaiResources: [{ modelVersionId: 200, weight: 0.75 }] } }],
      }),
      0.75
    );

    assert.equal(
      extractRecommendedWeight(
        { id: 201, images: [{ meta: { prompt: 'portrait <lora:neon_film_v2:0.65>' } }] },
        null,
        'neon_film_v2.safetensors'
      ),
      0.65
    );

    assert.equal(
      extractRecommendedWeight({ id: 202, images: [] }, 'Recommended strength 0.6 to 0.8 works best'),
      0.7
    );
  });

  it('strips HTML safely and normalizes Civitai metadata payloads', () => {
    const formatted = formatCivitaiHtmlDescription(
      '<p>Warm <b>cinematic</b> look.<br/>Use at <a href="https://example.com">guide</a>.</p>'
    );
    assert.equal(formatted, 'Warm cinematic look.\nUse at guide (https://example.com).');

    const ea = extractCivitaiEarlyAccessInfo({
      availability: 'EarlyAccess',
      earlyAccessEndsAt: '2099-01-01T00:00:00.000Z',
      earlyAccessConfig: { downloadPrice: 500, timeframe: 7 },
    });
    assert.equal(ea.isEarlyAccessActive, true);
    assert.deepEqual(ea.earlyAccessConfig, { downloadPrice: 500, timeframe: 7 });

    const normalized = normalizeCivitaiData(
      { id: 10, name: 'Test Style', nsfw: true, description: '<p>Parent desc</p>' },
      {
        id: 20,
        baseModel: 'Krea 2',
        trainedWords: ['neon_glow', 'neon_glow', ''],
        images: [
          { url: 'https://cdn.example.com/a.mp4', type: 'video' },
          { url: 'https://cdn.example.com/b.jpg', width: 1024, height: 1536 },
        ],
      }
    );
    assert.equal(normalized.civitaiUrl, 'https://civitai.red/models/10?modelVersionId=20');
    assert.deepEqual(normalized.trainedWords, ['neon_glow']);
    assert.equal(normalized.previewImages.length, 1);
    assert.equal(normalized.previewImages[0].url, 'https://cdn.example.com/b.jpg');
  });
});

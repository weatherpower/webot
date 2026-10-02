import { renderWarningCard, closeRenderer } from '../src/renderCard.js';
import { sampleWarning } from '../src/sampleWarning.js';

try {
  const result = await renderWarningCard(sampleWarning);
  console.log(JSON.stringify({
    ok: true,
    file: result.filePath,
    publicPath: result.publicPath,
    bytes: result.bytes
  }, null, 2));
} finally {
  await closeRenderer();
}

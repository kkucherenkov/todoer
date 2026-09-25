import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/openapi.yaml',
  output: { path: './src/generated', format: 'prettier' },
  plugins: ['@hey-api/client-fetch'],
});

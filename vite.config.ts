import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages "project" sites are served from a sub-path, e.g.
// https://<owner>.github.io/<repo>/  ->  assets must live under /<repo>/
// The Actions runner exposes GITHUB_PAGES=true and GITHUB_REPOSITORY=owner/repo.
// A custom-domain Pages site is served from the root, so BASE_PATH=/ overrides this.
//
// NOTE: an unset GitHub Actions repo variable (`${{ vars.X }}`) expands to an
// EMPTY STRING, not undefined — so BASE_PATH must be checked for emptiness,
// otherwise `base` becomes '' and Vite emits relative asset paths that break
// on any deep link.
const explicitBase = process.env.BASE_PATH?.trim()
const projectPagesBase =
    process.env.GITHUB_PAGES === 'true' && process.env.GITHUB_REPOSITORY
        ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
        : '/'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: explicitBase || projectPagesBase,
})

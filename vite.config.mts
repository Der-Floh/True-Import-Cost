import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    plugins: [vue()],
    define: {
        'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
    },
    publicDir: false,
    build: {
        // One IIFE bundle without code splitting: the webview's content security policy allows no dynamic imports.
        lib: {
            entry: fileURLToPath(new URL('./src/webview/main.ts', import.meta.url)),
            formats: ['iife'],
            name: 'TrueImportCostDashboard',
            fileName: () => 'dashboard.js',
        },
        outDir: 'public',
        emptyOutDir: false,
        cssCodeSplit: false,
        assetsInlineLimit: 8192,
        sourcemap: false,
        rollupOptions: {
            output: {
                assetFileNames: (info) => {
                    const name = info.names?.[0] ?? '';
                    return name.endsWith('.css') ? 'dashboard.css' : (name || '[name][extname]');
                },
            },
        },
    },
}));

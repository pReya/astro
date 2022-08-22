import type { AstroConfig, AstroIntegration } from 'astro';
import { ssgBuild } from './build/ssg.js';
import { ssrBuild } from './build/ssr.js';
import { PKG_NAME, ROUTE_PATTERN } from './constants.js';
import { ImageService, TransformOptions } from './loaders/index.js';
import type { LoggerLevel } from './utils/logger.js';
import { filenameFormat, propsToFilename } from './utils/paths.js';
import { createPlugin } from './vite-plugin-astro-image.js';

export { getImage } from './lib/get-image.js';
export { getPicture } from './lib/get-picture.js';
export * from './loaders/index.js';
export type { ImageMetadata } from './vite-plugin-astro-image.js';

interface ImageIntegration {
	loader?: ImageService;
	addStaticImage?: (transform: TransformOptions) => void;
	filenameFormat?: (transform: TransformOptions, searchParams: URLSearchParams) => string;
}

declare global {
	// eslint-disable-next-line no-var
	var astroImage: ImageIntegration | undefined;
}

export interface IntegrationOptions {
	/**
	 * Entry point for the @type {HostedImageService} or @type {LocalImageService} to be used.
	 */
	serviceEntryPoint?: string;
	logLevel?: LoggerLevel;
}

export default function integration(options: IntegrationOptions = {}): AstroIntegration {
	const resolvedOptions = {
		serviceEntryPoint: '@astrojs/image/squoosh',
		logLevel: 'info' as LoggerLevel,
		...options,
	};

	// During SSG builds, this is used to track all transformed images required.
	const staticImages = new Map<string, Map<string, TransformOptions>>();

	let _config: AstroConfig;
	let output: 'server' | 'static';

	function getViteConfiguration() {
		return {
			plugins: [createPlugin(_config, resolvedOptions)],
			optimizeDeps: {
				include: [
					'image-size',
					resolvedOptions.serviceEntryPoint === '@astrojs/image/sharp' && 'sharp',
					resolvedOptions.serviceEntryPoint === '@astrojs/image/squoosh' && '@squoosh/lib',
				].filter(Boolean),
			},
			ssr: {
				noExternal: ['@astrojs/image', resolvedOptions.serviceEntryPoint],
			}
		};
	}

	return {
		name: PKG_NAME,
		hooks: {
			'astro:config:setup': ({ command, config, injectRoute, updateConfig }) => {
				_config = config;

				// Always treat `astro dev` as SSR mode, even without an adapter
				output = command === 'dev' ? 'server' : config.output;

				updateConfig({ vite: getViteConfiguration() });

				if (output === 'server') {
					injectRoute({
						pattern: ROUTE_PATTERN,
						entryPoint:
							command === 'dev' ? '@astrojs/image/endpoints/dev' : '@astrojs/image/endpoints/prod',
					});
				}
			},
			'astro:server:setup': async ({ server }) => {
				globalThis.astroImage = {};
			},
			'astro:build:setup': () => {
				// Used to cache all images rendered to HTML
				// Added to globalThis to share the same map in Node and Vite
				function addStaticImage(transform: TransformOptions) {
					const srcTranforms = staticImages.has(transform.src)
						? staticImages.get(transform.src)!
						: new Map<string, TransformOptions>();

					srcTranforms.set(propsToFilename(transform), transform);

					staticImages.set(transform.src, srcTranforms);
				}

				// Helpers for building static images should only be available for SSG
				globalThis.astroImage =
					output === 'static'
						? {
								addStaticImage,
								filenameFormat,
						  }
						: {};
			},
			'astro:build:done': async ({ dir }) => {
				if (output === 'server') {
					// for SSR builds, copy all image files from src to dist
					// to make sure they are available for use in production
					await ssrBuild({ srcDir: _config.srcDir, outDir: dir });
				} else {
					// for SSG builds, build all requested image transforms to dist
					const loader = globalThis?.astroImage?.loader;

					if (loader && 'transform' in loader && staticImages.size > 0) {
						await ssgBuild({
							loader,
							staticImages,
							srcDir: _config.srcDir,
							outDir: dir,
							logLevel: resolvedOptions.logLevel,
						});
					}
				}
			},
		},
	};
}

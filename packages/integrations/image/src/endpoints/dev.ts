import type { APIRoute } from 'astro';
import { lookup } from 'mrmime';
import { loadImage } from '../utils/images.js';

export const get: APIRoute = async ({ request }) => {
	// @ts-ignore
	const { default: loader } = await import('virtual:image-loader');

	try {
		const url = new URL(request.url);
		const transform = loader.parseTransform(url.searchParams);

		if (!transform) {
			return new Response('Bad Request', { status: 400 });
		}

		const inputBuffer = await loadImage(transform.src);

		if (!inputBuffer) {
			return new Response(`"${transform.src} not found`, { status: 404 });
		}

		const { data, format } = await loader.transform(inputBuffer, transform);

		return new Response(data, {
			status: 200,
			headers: {
				'Content-Type': lookup(format) || '',
			},
		});
	} catch (err: unknown) {
		return new Response(`Server Error: ${err}`, { status: 500 });
	}
};

export async function graphqlRequest<T>(
	baseUrl: string,
	query: string,
	variables?: Record<string, any>,
	signal?: AbortSignal,
	timeoutMs = 30000
): Promise<T> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
	const combinedSignal = signal
		? combineSignals(signal, controller.signal)
		: controller.signal
	try {
		const response = await fetch(`${baseUrl}/api`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: combinedSignal,
		})
		if (!response.ok) {
			const text = await response.text()
			let msg = `HTTP ${response.status}`
			try {
				const err = JSON.parse(text)
				if (err.errors) msg = err.errors[0].message
			} catch { /* ignore parse errors */ }
			throw new Error(msg)
		}
		const result = await response.json()
		if (result.errors) throw new Error(result.errors[0].message)
		return result.data as T
	} finally {
		clearTimeout(timeoutId)
	}
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
	const controller = new AbortController()
	for (const s of signals) {
		if (s.aborted) {
			controller.abort(s.reason)
			return controller.signal
		}
		s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
	}
	return controller.signal
}

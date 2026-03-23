async function list(options) {
  const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts')
  url.searchParams.set('key', options?.key)
  const response = await fetch(url)
  const payload = await response.json()
  return payload
}

const payload = await list({ key: process.env.GOOGLE_FONTS_API_KEY })
console.log(JSON.stringify(payload, null, 2))

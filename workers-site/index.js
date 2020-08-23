import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler'

/**
 * The DEBUG flag will do two things that help during development:
 * 1. we will skip caching on the edge, which makes it easier to
 *    debug.
 * 2. we will return an error message on exception in your Response rather
 *    than the default 404.html page.
 */
const DEBUG = false

addEventListener('fetch', event => {
  try {
    event.respondWith(handleEvent(event))
  } catch (e) {
    if (DEBUG) {
      return event.respondWith(
        new Response(e.message || e.toString(), {
          status: 500,
        }),
      )
    }
    event.respondWith(new Response('Internal Error', { status: 500 }))
  }
})

async function handleEvent(event) {
  const url = new URL(event.request.url)
  const accept = event.request.headers.get('accept')
  let options = {}

  /**
   * You can add custom logic to how we fetch your assets
   * by configuring the function `mapRequestToAsset`
   */
  //options.mapRequestToAsset = handlePrefix(/^\/docs/)

  try {
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      }
    }
    if (event.request.method === 'GET' &&
    url.pathname.startsWith('/api.nvseismolab.org/')) {
 
      // Proxy the webcam image file requests
      const imagePathname = 'http:/' + url.pathname.split(".jpg")[0].trim()
      return proxyRequest(imagePathname, event.request);
 
    } else {
      const page = await getAssetFromKV(event, options)

      // allow headers to be altered
      const response = new Response(page.body, page)

      response.headers.set('X-XSS-Protection', '1; mode=block')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('X-Frame-Options', 'DENY')
      response.headers.set('Referrer-Policy', 'unsafe-url')
      response.headers.set('Feature-Policy', 'none')

      return response
    }
  } catch (e) {
    // if an error is thrown try to serve the asset at 404.html
    if (!DEBUG) {
      try {
        let notFoundResponse = await getAssetFromKV(event, {
          mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/404.html`, req),
        })

        return new Response(notFoundResponse.body, { ...notFoundResponse, status: 404 })
      } catch (e) {}
    }

    return new Response(e.message || e.toString(), { status: 500 })
  }
}

/**
 * Here's one example of how to modify a request to
 * remove a specific prefix, in this case `/docs` from
 * the url. This can be useful if you are deploying to a
 * route on a zone, or if you only want your static content
 * to exist at a specific path.
 */
function handlePrefix(prefix) {
  return request => {
    // compute the default (e.g. / -> index.html)
    let defaultAssetKey = mapRequestToAsset(request)
    let url = new URL(defaultAssetKey.url)

    // strip the prefix from the path for lookup
    url.pathname = url.pathname.replace(prefix, '/')

    // inherit all other props from the default request
    return new Request(url.toString(), defaultAssetKey)
  }
}

/**
 * Based off Fast Google Fonts by @pmeenan
 * Code: https://github.com/cloudflare/worker-examples/blob/master/examples/fast-google-fonts/fast-google-fonts.js
 * Blog post: https://blog.cloudflare.com/fast-google-fonts-with-cloudflare-workers/
 * Generate a new request based on the original. Filter the request
 * headers to prevent leaking user data (cookies, etc) and filter
 * the response headers to prevent the origin setting policy on
 * our origin.
 * 
 * @param {*} url The URL to proxy
 * @param {*} request The original request (to copy parameters from)
 */


async function proxyRequest(url, request) {
  // Only pass through a subset of request headers
  let init = {
    method: request.method,
    headers: {},
    cf: {      
      // Always cache this fetch regardless of content type
      // for a max of 30 seconds before revalidating the resource
      cacheTtl: 30
      // Enterprise-only cache features available for route deployments:     
      //cacheEverything: true,
      //cacheKey: request.url.toString(),
      //cacheTtlByStatus: { "200-299": 30, 404: 1, "500-599": -1 }
      
    },
  };
  const proxyHeaders = ["Accept",
                        "Accept-Encoding",
                        "Accept-Language",
                        "Referer",
                        "User-Agent"];
  for (let name of proxyHeaders) {
    let value = request.headers.get(name);
    if (value) {
      init.headers[name] = value;
    }
  }
  const clientAddr = request.headers.get('cf-connecting-ip');
  if (clientAddr) {
    init.headers['X-Forwarded-For'] = clientAddr;
  }
  
  // Only include a strict subset of response headers
  try {
    const response = await fetch(url, init);
    if (response) {
      const responseHeaders = ["Content-Type",
                              "Cache-Control",
                              "Expires",
                              "Accept-Ranges",
                              "Date",
                              "Last-Modified",
                              "ETag",
                              "CF-Cache-Status"];
      let responseInit = {status: response.status,
                          statusText: response.statusText,
                          headers: { "Cache-Control": "public, max-age=10" }};
      for (let name of responseHeaders) {
        let value = response.headers.get(name);
        if (value) {
          responseInit.headers[name] = value;
        }

      }
      const newResponse = new Response(response.body, responseInit);
      let cacheStatus = newResponse.headers.get("CF-Cache-Status");
      console.log('Proxy Image URL: ' + url)
      console.log('CF-Cache-Status: ' + cacheStatus)
      return newResponse; 
    }
    return response;
  } catch (e) {
    return new Response(e.message || e.toString(), { status: 500 })
  }
}
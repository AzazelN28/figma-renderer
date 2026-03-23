<script setup>
import { ref, watch } from 'vue'
import Fig from '~/figma/Fig.js'

const canvas = ref(null)

class CommandBlob {
  #dataView
  #byteOffset
  #path

  constructor(u8) {
    this.#dataView = new DataView(u8.buffer)
  }

  get availableBytes() {
    return this.#dataView.byteLength - this.#byteOffset
  }

  #readCommand() {
    const command = this.#dataView.getUint8(this.#byteOffset)
    this.#byteOffset++
    return command
  }

  #readNumber() {
    const number = this.#dataView.getFloat32(this.#byteOffset, true)
    this.#byteOffset += 4
    return number
  }

  #read() {
    if (this.availableBytes <= 0) {
      return null
    }
    const type = this.#readCommand()
    switch (type) {
      case 0: {
        return {}
      }

      case 1: {
        const x = this.#readNumber()
        const y = this.#readNumber()
        return { type, params: [x, y] }
      }

      case 2: {
        const x = this.#readNumber()
        const y = this.#readNumber()
        return { type, params: [x, y] }
      }

      case 4: {
        const x = this.#readNumber()
        const y = this.#readNumber()
        const ax = this.#readNumber()
        const ay = this.#readNumber()
        const bx = this.#readNumber()
        const by = this.#readNumber()
        return { type, params: [x, y, ax, ay, bx, by] }
      }

      default:
        throw new TypeError('Invalid command value')
    }
  }

  getPath2D() {
    if (this.#path) {
      return this.#path
    }
    const path = new Path2D()
    this.#byteOffset = 0
    let command = null
    while (command = this.#read()) {
      switch (command.type) {
        case 0:
          path.closePath()
          break
        case 1:
          path.moveTo(...command.params)
          break
        case 2:
          path.lineTo(...command.params)
          break
        case 4:
          path.bezierCurveTo(...command.params)
          break
      }
    }
    this.#path = path
    return path
  }
}

function rgba(r, g, b, a) {
  return `rgba(${Math.floor(r * 255)}, ${Math.floor(g * 255)}, ${Math.floor(b * 255)}, ${a})`
}

function getColor(color) {
  return rgba(color.r, color.g, color.b, color.a)
}

function getSolid(paint) {
  return getColor(paint.color)
}

function resize(canvas, width = Math.floor(canvas.clientWidth * globalThis.devicePixelRatio), height = Math.floor(canvas.clientHeight * globalThis.devicePixelRatio)) {
  let resized = false
  if (canvas.width !== width) {
    canvas.width = width
    resized = true
  }
  if (canvas.height !== height) {
    canvas.height = height
    resized = true
  }
  return resized
}

function getFontWeightByName(fontWeightName) {
  const normalizedFontWeightName = fontWeightName.toString().toLowerCase().replaceAll(/(italic|oblique)/g, '').trim()
  if (!normalizedFontWeightName)
    return 400

  const patterns = [
    { regex: /^(100|200|300|400|500|600|700|800|900)$/, value: (m) => parseInt(m[0]) },
    { regex: /^(thin|hairline)$/, value: 100 },
    { regex: /^(extra[\s-]?light|ultra[\s-]?light)$/, value: 200 },
    { regex: /^light$/, value: 300 },
    { regex: /^(normal|regular)$/, value: 400 },
    { regex: /^medium$/, value: 500 },
    { regex: /^(semi[\s-]?bold|demibold)$/, value: 600 },
    { regex: /^bold$/, value: 700 },
    { regex: /^(extra[\s-]?bold|ultra[\s-]?bold)$/, value: 800 },
    { regex: /^(black|heavy)$/, value: 900 }
  ]
  for (const pattern of patterns) {
    const match = normalizedFontWeightName.match(pattern.regex)
    if (match) {
      return typeof pattern.value === 'function'
        ? pattern.value(match)
        : pattern.value
    }
  }
  throw new Error(`Font weight name "${fontWeightName}" not found`)
}

async function fetchGoogleFonts() {
  const response = await fetch('google-fonts.json')
  const payload = await response.json()
  return payload
}

async function fetchFig(url) {
  const response = await fetch(url)
  const fig = await Fig.read(await response.blob())
  return fig
}

function getMatrixFromTransform(transform) {
  return DOMMatrix.fromFloat32Array(new Float32Array([
    transform.m00,
    transform.m01,
    transform.m10,
    transform.m11,
    transform.m02,
    transform.m12,
  ]))
}

async function open(url, cx) {
  const fig = await fetchFig(url)

  // Antes de poder renderizar el documento
  // necesitamos cargar las fuentes necesarias.
  // Para ello recorremos todos los textos del
  // documento y buscamos las fontNames.
  const googleFonts = await fetchGoogleFonts()
  const fonts = fig.getFonts()
  for (const [_, fontName] of fonts) {
    const googleFont = googleFonts.items.find((item) => item.family === fontName.family)
    if (!googleFont) {
      console.warn(fontName, googleFont)
      continue
    }
    const isItalic = fontName.style.toLowerCase().includes('italic')
    const fontStyle = isItalic ? 'italic' : ''
    const fontWeight = getFontWeightByName(fontName.style)
    const fileId = `${fontWeight}${fontStyle}`
    const fontFace = new FontFace(
      fontName.family,
      `url(${googleFont.files[fileId]})`,
      {
        weight: fontWeight,
        style: fontStyle,
      }
    )
    document.fonts.add(fontFace)
  }

  // Buscamos todas las páginas del documento
  // y cogemos la primera.
  const pages = fig.getPages()
  const [page] = pages

  // Los patrones en realidad son las imágenes que se utilizan.
  const patterns = new Map()
  function getPattern(paint) {
    console.log(paint)
    const imageHash = Array.from(paint.image.hash, v => v.toString(16).padStart(2, '0')).join('')
    if (!patterns.has(imageHash)) {
      const imageBitmap = fig.images.get(imageHash)
      const pattern = cx.createPattern(imageBitmap, "repeat")
      const matrix = getMatrixFromTransform(paint.transform)
      if (paint.scale) {
        matrix.scaleSelf(paint.scale)
      }
      if (paint.rotation) {
        matrix.rotateSelf(paint.rotation)
      }
      pattern.setTransform(matrix)
      patterns.set(imageHash, pattern)
    }
    return patterns.get(imageHash)
  }

  function getGradientLinear(paint) {
    const gradient = cx.createLinearGradient(
      0, 0, 1, 0
    )
    for (const stop of paint.stops) {
      gradient.addColorStop(stop.position, getColor(stop.color))
    }
    return gradient
  }

  function getGradientRadial(paint) {

  }

  function getStyle(paint) {
    switch (paint.type) {
      case 'SOLID': return getSolid(paint)
      case 'IMAGE': return getPattern(paint)
      case 'GRADIENT_LINEAR': return getGradientLinear(paint)
      case 'GRADIENT_RADIAL': return getGradientRadial(paint)
    }
  }

  const commandBlobs = new Map()
  function getCommandBlob(commandsBlobId) {
    if (!commandBlobs.has(commandsBlobId)) {
      const commandsBlob = fig.getBlob(commandsBlobId)
      const bytes = commandsBlob.bytes
      const commandBlob = new CommandBlob(bytes)
      commandBlobs.set(commandsBlobId, commandBlob)
    }
    return commandBlobs.get(commandsBlobId)
  }

  let x = -300, y = -0, scale = 1

  // const sizes = new Set()
  function setup(canvas) {
    canvas.addEventListener('pointermove', (e) => {
      // console.log(e.type, e)
      // renderPage(page)
    })
    canvas.addEventListener('wheel', (e) => {
      // console.log(e.type, e)
      if (e.ctrlKey) {
        if (e.deltaY > 0) {
          scale *= 1.1
        } else {
          scale *= 0.9
        }
      } else {
        x -= e.deltaX
        y -= e.deltaY
      }
      renderPage(page)
    })
  }

  function render(nodeChange) {
    cx.save()
    if (nodeChange.visible) {
      if (nodeChange.type !== 'CANVAS') {
        cx.transform(
          nodeChange.transform.m00,
          nodeChange.transform.m01,
          nodeChange.transform.m10,
          nodeChange.transform.m11,
          nodeChange.transform.m02,
          nodeChange.transform.m12,
        )
      }

      if (nodeChange.effects) {
        for (const effect of nodeChange.effects) {
          if (!effect.visible) continue
          switch (effect.type) {
            case 'INNER_SHADOW':
              // TODO: Sombra interior
              break
            case 'DROP_SHADOW':
              cx.shadowBlur = effect.radius
              cx.shadowColor = getColor(effect.color)
              cx.shadowOffsetX = effect.offset.x
              cx.shadowOffsetY = effect.offset.y
              // TODO: effect.blendMode
              // TODO: effect.showShadowBehindNode
              // TODO: effect.spread
              break
            case 'BACKGROUND_BLUR':
              break
          }
        }
      }

      switch (nodeChange.type) {
        case "CANVAS":
          // NOOP
          break;

        case "FRAME":
          if (!nodeChange.frameMaskDisabled) {
            cx.beginPath()
            cx.rect(0, 0, nodeChange.size.x, nodeChange.size.y)
            cx.clip()
          }
          if (nodeChange.fillPaints) {
            for (const paint of nodeChange.fillPaints) {
              if (!paint.visible) continue;
              cx.globalAlpha = paint.opacity;
              cx.fillStyle = getStyle(paint)
              cx.fillRect(0, 0, nodeChange.size.x, nodeChange.size.y)
            }
          }
          if (nodeChange.strokePaints) {
            cx.lineWidth = nodeChange.strokeWeight
            for (const paint of nodeChange.strokePaints) {
              if (!paint.visible) continue;
              cx.globalAlpha = paint.opacity;
              cx.strokeStyle = getStyle(paint)
              cx.strokeRect(0, 0, nodeChange.size.x, nodeChange.size.y)
            }
          }
          break;

        case "ROUNDED_RECTANGLE":
          if (nodeChange.fillPaints) {
            for (const paint of nodeChange.fillPaints) {
              if (!paint.visible) continue;
              cx.globalAlpha = paint.opacity;
              cx.fillStyle = getStyle(paint)
              cx.fillRect(0, 0, nodeChange.size.x, nodeChange.size.y)
            }
          }
          if (nodeChange.strokePaints) {
            if (nodeChange.dashPattern) {
              cx.setLineDash(nodeChange.dashPattern)
            }
            cx.lineWidth = nodeChange.strokeWeight
            for (const paint of nodeChange.strokePaints) {
              if (!paint.visible) continue;
              cx.globalAlpha = paint.opacity;
              cx.strokeStyle = getStyle(paint)
              cx.strokeRect(0, 0, nodeChange.size.x, nodeChange.size.y)
            }
          }
          break;

        case "TEXT":
          // if (nodeChange.textData.characters.startsWith('Frames in')) {
          //   console.log(nodeChange)
          // }
          cx.font = `${nodeChange.fontName.style} ${nodeChange.fontSize}px ${nodeChange.fontName.family}, sans-serif`
          cx.textAlign = 'left'
          cx.textBaseline = 'top'
          if (nodeChange.fillPaints) {
            for (const paint of nodeChange.fillPaints) {
              if (!paint.visible) continue;
              for (const baseline of nodeChange.derivedTextData.baselines) {
                const line = nodeChange.textData.characters.slice(baseline.firstCharacter, baseline.endCharacter)
                cx.globalAlpha = paint.opacity;
                cx.fillStyle = getStyle(paint)
                cx.fillText(line, baseline.position.x, baseline.position.y)
              }
            }
          }
          if (nodeChange.strokePaints) {
            cx.lineWidth = nodeChange.strokeWeight
            for (const paint of nodeChange.strokePaints) {
              if (!paint.visible) continue;
              for (const baseline of nodeChange.derivedTextData.baselines) {
                const line = nodeChange.textData.characters.slice(baseline.firstCharacter, baseline.endCharacter)
                cx.globalAlpha = paint.opacity;
                cx.fillStyle = getStyle(paint)
                cx.fillText(line, baseline.position.x, baseline.position.y)
              }
            }
          }
          break;

        case "BOOLEAN_OPERATION":
          // console.log(nodeChange.type, nodeChange.booleanOperation)
          switch(nodeChange.booleanOperation) {
            case 'UNION':
            case 'SUBTRACT':
            case 'XOR':
              break;
          }
          break;

        case "VECTOR":
          if (nodeChange.fillGeometry) {
            for (const fillGeometry of nodeChange.fillGeometry) {
              const commandBlob = getCommandBlob(fillGeometry.commandsBlob)
              if (nodeChange.fillPaints) {
                for (const paint of nodeChange.fillPaints) {
                  if (!paint.visible) continue;
                  cx.globalApha = paint.opacity;
                  cx.fillStyle = getStyle(paint)
                  cx.fill(commandBlob.getPath2D())
                }
              }
            }
          }
          if (nodeChange.strokeGeometry) {
            for (const strokeGeometry of nodeChange.strokeGeometry) {
              const commandBlob = getCommandBlob(strokeGeometry.commandsBlob)
              if (nodeChange.strokePaints) {
                cx.lineWidth = nodeChange.strokeWeight
                for (const paint of nodeChange.strokePaints) {
                  if (!paint.visible) continue;
                  cx.globalApha = paint.opacity;
                  cx.strokeStyle = getStyle(paint)
                  cx.stroke(commandBlob.getPath2D())
                }
              }
            }
          }
          break;

        case "LINE":
          if (nodeChange.strokeWeight && nodeChange.strokePaints) {
            cx.lineWidth = nodeChange.strokeWeight
            for (const paint of nodeChange.strokePaints) {
              if (!paint.visible) continue;
              cx.globalApha = paint.opacity;
              cx.strokeStyle = getStyle(paint)
              cx.beginPath()
              cx.moveTo(0, 0)
              cx.lineTo(nodeChange.size.x, nodeChange.size.y)
              cx.stroke()
            }
          }
          break;

        case "ELLIPSE":
          if (nodeChange.fillPaints) {
            for (const paint of nodeChange.fillPaints) {
              if (!paint.visible) continue;
              cx.globalApha = paint.opacity;
              cx.fillStyle = getStyle(paint)
              cx.beginPath()
              cx.ellipse(nodeChange.size.x / 2, nodeChange.size.y / 2, nodeChange.size.x / 2, nodeChange.size.y / 2, 0, 0, Math.PI * 2)
              cx.closePath()
              cx.fill()
            }
          }
          if (nodeChange.strokePaints) {
            for (const paint of nodeChange.strokePaints) {
              if (!paint.visible) continue;
              cx.globalApha = paint.opacity;
              cx.strokeStyle = getStyle(paint)
              cx.beginPath()
              cx.ellipse(nodeChange.size.x / 2, nodeChange.size.y / 2, nodeChange.size.x, nodeChange.size.y, 0, 0, Math.PI * 2)
              cx.closePath()
              cx.stroke()
            }
          }
          break;
      }

      const children = fig.getChildrenOf(nodeChange.guid)
      for (const child of children) {
        render(child)
      }
    }
    cx.restore()
  }

  function renderPage(page) {
    cx.clearRect(0, 0, cx.canvas.width, cx.canvas.height)
    if (page.backgroundEnabled) {
      cx.fillStyle = getColor(page.backgroundColor)
      cx.fillRect(0, 0, cx.canvas.width, cx.canvas.height)
    }
    cx.save()
    cx.translate(cx.canvas.width / 2, cx.canvas.height / 2)
    cx.scale(scale, scale)
    cx.translate(x, y)
    render(page)
    cx.restore()
  }

  setup(cx.canvas)
  renderPage(page)

  // Los tamaños de los commands no
  // son fijos.
  /*
  const commonDenominators = new Map()
  const sizesA = Array.from(sizes)
  for (let i = 0; i < sizesA.length - 1; i++) {
    const a = sizesA[i]
    for (let j = i + 1; j < sizesA.length; j++) {
      const b = sizesA[j]
      let found = false
      for (let k = 2; k <= 48; k++) {
        if ((a % k) === 0 && (b % k) === 0) {
          if (!commonDenominators.has(k)) {
            commonDenominators.set(k, 0)
          }
          commonDenominators.set(k, commonDenominators.get(k) + 1)
          found = true
        }
      }
      if (found)
        break;
    }
  }

  console.log(sizesA.length)
  console.log(commonDenominators)
  */
}

watch(canvas, (canvas) => {
  if (canvas) {
    resize(canvas)
    open('Figma basics.fig', canvas.getContext('2d'))
  }
})

</script>

<template>
  <canvas ref="canvas"></canvas>
</template>

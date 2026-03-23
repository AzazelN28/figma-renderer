import JSZip from 'jszip'
import * as kiwi from 'kiwi-schema'
import pako from 'pako'
import * as zstdify from 'zstdify'

export class Fig {
  static async read(fileOrBlob, options) {
    function decompress(compressed) {
      try {
        return pako.inflateRaw(compressed)
      } catch (error) {
        try {
          return zstdify.decompress(compressed)
        } catch (error) {
          throw new Error('Cannot decompress')
        }
      }
    }

    try {
      const start = Date.now()
      const zip = await JSZip.loadAsync(fileOrBlob)
      let thumbnail = options?.thumbnail ?? true
        ? await zip.file('thumbnail.png').async('blob')
        : null
      let meta = options?.meta ?? true
        ? JSON.parse(await zip.file('meta.json').async('text'))
        : null

      // Creamos un mapa con todas las imágenes.
      const images = new Map()
      // Obtenemos la lista de todas las imágenes.
      const imageFiles = Object.values(zip.files).filter(
        (file) => file.name.startsWith('images/') && !file.dir
      )
      // Cargamos todas las imágenes.
      for (const imageFile of imageFiles) {
        const imageBitmap = await createImageBitmap(await zip.file(imageFile.name).async('blob'))
        const imageKey = imageFile.name.slice(imageFile.name.indexOf('/') + 1)
        images.set(imageKey, imageBitmap)
      }
      // Obtenemos los datos del binario de Figma.
      const arrayBuffer = await zip.file('canvas.fig').async('arraybuffer')
      const textDecoder = new TextDecoder()
      const signature = textDecoder.decode(arrayBuffer.slice(0, 8))
      if (signature !== 'fig-kiwi') {
        throw new Error('Invalid .fig file')
      }
      const dataView = new DataView(arrayBuffer)
      const version = dataView.getUint32(8, true)
      const schemaSize = dataView.getUint32(12, true)
      const schemaCompressed = new Uint8Array(
        dataView.buffer.slice(16, 16 + schemaSize)
      )
      const dataSize = dataView.getUint32(16 + schemaSize, true)
      const dataCompressed = new Uint8Array(
        dataView.buffer.slice(20 + schemaSize)
      )
      const schemaDecompressed = decompress(schemaCompressed)
      const schema = kiwi.decodeBinarySchema(schemaDecompressed)
      const compiledSchema = kiwi.compileSchema(schema)
      const dataDecompressed = decompress(dataCompressed)
      const data = compiledSchema.decodeMessage(dataDecompressed)
      const time = Date.now() - start
      const stats = {
        time: time,
        schema: {
          compressed: schemaSize,
          decompressed: schemaDecompressed.byteLength
        },
        data: {
          compressed: dataSize,
          decompressed: dataDecompressed.byteLength
        }
      }
      return new Fig({ version, meta, stats, thumbnail, schema, data, images })
    } catch (error) {
      throw error
    }
  }

  #version
  #meta
  #stats
  #thumbnail
  #schema
  #data
  #images

  constructor({ version, meta, stats, thumbnail, schema, data, images }) {
    this.#version = version
    this.#meta = meta
    this.#stats = stats
    this.#thumbnail = thumbnail
    this.#schema = schema
    this.#data = data
    this.#images = images
  }

  get version() {
    return this.#version
  }
  get meta() {
    return this.#meta
  }
  get stats() {
    return this.#stats
  }
  get thumbnail() {
    return this.#thumbnail
  }
  get schema() {
    return this.#schema
  }
  get data() {
    return this.#data
  }
  get images() {
    return this.#images
  }

  getDocument() {
    return this.#data.nodeChanges.find(
      (nodeChange) => nodeChange.type === 'DOCUMENT'
    )
  }

  getPages() {
    return this.#data.nodeChanges.filter(
      (nodeChange) =>
        nodeChange.type === 'CANVAS' &&
        nodeChange.phase === 'CREATED' &&
        !nodeChange?.internalOnly
    )
  }

  getFonts() {
    return this.#data.nodeChanges.filter((nodeChange) => {
      return nodeChange.type === 'TEXT'
    }).reduce((acc, nodeChange) => {
      if (nodeChange.fontName.postscript)
        acc.set(nodeChange.fontName.postscript, nodeChange.fontName)
      else
        acc.set(`${nodeChange.fontName.family}-${nodeChange.fontName.style}`, nodeChange.fontName)
      return acc
    }, new Map())
  }

  getBlob(blobIndex) {
    return this.#data.blobs[blobIndex]
  }

  getChildrenOf(guid) {
    return this.#data.nodeChanges.filter((nodeChange) => {
      if (!nodeChange.parentIndex) return false
      return (
        nodeChange.parentIndex.guid.localID === guid.localID &&
        nodeChange.parentIndex.guid.sessionID === guid.sessionID
      )
    })
  }
}

export default Fig

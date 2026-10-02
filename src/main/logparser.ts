/**
 * Minecraft is started with Mojang's log4j config, which writes XML events to stdout
 * (the official launcher parses them). This turns that stream back into readable lines.
 */
export class GameLogParser {
  private buffer = ''

  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const start = this.buffer.indexOf('<log4j:Event')
      if (start === -1) {
        const nl = this.buffer.lastIndexOf('\n')
        if (nl === -1) return
        this.plain(this.buffer.slice(0, nl))
        this.buffer = this.buffer.slice(nl + 1)
        return
      }
      if (start > 0) {
        this.plain(this.buffer.slice(0, start))
        this.buffer = this.buffer.slice(start)
        continue
      }
      const endTag = '</log4j:Event>'
      const end = this.buffer.indexOf(endTag)
      if (end === -1) return
      this.event(this.buffer.slice(0, end + endTag.length))
      this.buffer = this.buffer.slice(end + endTag.length)
    }
  }

  flush(): void {
    if (this.buffer.trim()) this.plain(this.buffer)
    this.buffer = ''
  }

  private plain(text: string) {
    for (const line of text.split(/\r?\n/)) if (line.trim()) this.emit(line)
  }

  private event(xml: string) {
    const attr = (name: string) => xml.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
    const cdata = (tag: string) => xml.match(new RegExp(`<log4j:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></log4j:${tag}>`))?.[1]
    const time = new Date(Number(attr('timestamp')) || Date.now()).toTimeString().slice(0, 8)
    this.plain(`[${time}] [${attr('thread')}/${attr('level')}]: ${cdata('Message') ?? ''}`)
    const throwable = cdata('Throwable')
    if (throwable) this.plain(throwable)
  }
}

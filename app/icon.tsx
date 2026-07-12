import { readFile } from "node:fs/promises"
import path from "node:path"

import { ImageResponse } from "next/og"

export const size = {
  width: 512,
  height: 512,
}

export const contentType = "image/png"

export default async function Icon() {
  const mark = await readFile(
    path.resolve(process.cwd(), "public/lyon-industries-mark.png")
  )
  const markData = `data:image/png;base64,${mark.toString("base64")}`

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#05080B",
      }}
    >
      <img src={markData} alt="" width={304} height={382} style={{ objectFit: "contain" }} />
    </div>,
    size
  )
}

package main

import (
	"fmt"
	"io"
)

func writeOGTags(w io.Writer, params Params) {
	var ogTitle, ogDescription, ogImage string

	for _, param := range params {
		switch param[0] {
		case "og-title":
			ogTitle = param[1]
		case "og-description":
			ogDescription = param[1]
		case "og-image":
			ogImage = param[1]
		}
	}

	if ogTitle == "" && ogDescription == "" && ogImage == "" {
		return
	}

	if ogTitle != "" {
		fmt.Fprintf(w, "    <meta property=\"og:title\" content=\"%s\">\n", ogTitle)
		fmt.Fprintf(w, "    <meta name=\"twitter:title\" content=\"%s\">\n", ogTitle)
	}
	if ogDescription != "" {
		fmt.Fprintf(w, "    <meta property=\"og:description\" content=\"%s\">\n", ogDescription)
		fmt.Fprintf(w, "    <meta name=\"twitter:description\" content=\"%s\">\n", ogDescription)
		fmt.Fprintf(w, "    <meta name=\"description\" content=\"%s\">\n", ogDescription)
	}
	if ogImage != "" {
		fmt.Fprintf(w, "    <meta property=\"og:image\" content=\"%s\">\n", ogImage)
		fmt.Fprintf(w, "    <meta property=\"og:image:width\" content=\"1200\">\n")
		fmt.Fprintf(w, "    <meta property=\"og:image:height\" content=\"630\">\n")
		fmt.Fprintf(w, "    <meta name=\"twitter:card\" content=\"summary_large_image\">\n")
		fmt.Fprintf(w, "    <meta name=\"twitter:image\" content=\"%s\">\n", ogImage)
	}
}

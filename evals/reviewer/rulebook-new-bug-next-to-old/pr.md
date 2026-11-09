# refactor(plugin): count the plugin's output in bytes, by name (#999)

The contract: a plugin's stdout and stderr together may hold at most maxBytes bytes; past that it is killed.
chunk.length is the byte count of a Buffer already; byteLength says so.

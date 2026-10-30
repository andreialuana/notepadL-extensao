# notepadL — Extensão Chrome

Bloco de notas com conta de utilizador, sincronização e partilha de notas entre utilizadores.

## Instalar

1. Descarregue este repositório (Code → Download ZIP) e extraia
2. Abra `chrome://extensions` no Chrome
3. Ative o **Modo de programador** (canto superior direito)
4. Clique em **Carregar sem compactação**
5. Selecione a pasta extraída (a que contém o `manifest.json`)

## Ficheiros

- `manifest.json` — Configuração da extensão (Manifest V3)
- `popup.html` — Interface do popup
- `popup.css` — Estilos
- `popup.js` — Lógica da interface
- `api.js` — Comunicação com o servidor
- `background.js` — Menu de contexto e notificações
- `icons/` — Ícones da extensão

## Configuração do servidor

Ao abrir a extensão, clique no ícone ⚙ para definir o endereço do servidor.

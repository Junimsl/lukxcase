# LUKX CASE — Catálogo de capinhas

Catálogo interativo publicado como Artifact no claude.ai. Público para clientes (somente leitura) e com área administrativa para quem tem permissão de edição.

## Estrutura

```
index.html                 página (cabeçalho, seção inicial, filtros, grid, rodapé)
css/tokens.css             tokens do Design System: cores oficiais, fontes, espaçamentos
css/app.css                estilos do catálogo público
css/admin.css              estilos da área administrativa
fonts/                     Tusker Grotesk 5600 Semibold, Sora (variável) e Sora Medium (arquivos oficiais)
brand/                     logotipo e ícone oficiais (PNG transparente, versão para fundo claro)
img/cases/                 imagens originais das capinhas (sem cortes nem conversão)
data/catalog.json          dados: categorias, produtos e duplicatas registradas
js/app.js                  inicialização e rotas (#, #<categoria>, #admin)
js/services/store.js       leitura do catálogo e salvamento (nova versão do artifact)
js/services/categories.js  categorias dinâmicas, contagens, filtro e pesquisa
js/services/classifier.js  classificação visual com Claude
js/services/images.js      SHA-256, assinatura visual (hash da arte) e preparo da imagem para análise
js/services/platform.js    acesso às capacidades do claude.ai (usuário, salvar, Claude, download)
js/ui/catalog.js           barra de filtros, grid paginado, estado vazio
js/ui/modal.js             visualização ampliada com navegação anterior/próxima
js/ui/admin.js             área administrativa
```

## Como gerenciar

1. Abra o catálogo no claude.ai com a conta dona (ou com acesso de edição) e clique em **Gerenciar**.
2. **Adicionar capinhas**: arraste uma ou várias imagens. Para cada uma o sistema:
   - calcula o SHA-256 do arquivo. Arquivo idêntico a um produto existente é bloqueado e registrado em Duplicatas;
   - calcula uma assinatura visual da arte (ignora o mockup do celular). Imagem igual reexportada ou redimensionada aparece como "Muito parecida" e só entra se você confirmar;
   - envia a imagem ao Claude, que analisa personagens, escudos, símbolos, textos e cores e sugere categorias, nome, palavras-chave e se a arte é personalizável;
   - abaixo de 60% de confiança a capinha fica em **Não classificadas** para revisão;
   - se o tema não existir (ex.: Dragon Ball), o Claude sugere uma categoria nova, criada ao publicar.
3. Revise e clique em **Adicionar ao catálogo e salvar**.
4. **Produtos**: renomear, editar descrição e palavras-chave, corrigir categorias (fica marcado como ajuste manual), reclassificar com Claude, ocultar ou excluir.
5. **Categorias**: criar, renomear, reordenar (ordem da barra de filtros), editar sinônimos de busca e remover.
6. Alterações ficam pendentes até **Salvar e publicar**. Cada salvamento cria uma nova versão do artifact; versões anteriores ficam no histórico.

## Autenticação e persistência

- O acesso de edição é o do próprio claude.ai: só o dono e quem recebeu permissão de edição veem e usam a área administrativa. O servidor recusa salvamentos de quem não pode editar.
- Os dados ficam em `data/catalog.json` e as imagens em `img/cases/`, dentro do próprio artifact. Nada depende do armazenamento do navegador.

## Classificação visual: requisitos

- Funciona com o catálogo aberto no claude.ai. A primeira análise pede autorização e usa a cota de Claude da conta de quem está gerenciando.
- Sem configuração de chave de API.
- Fora do claude.ai (link público ou cópia hospedada em outro lugar) o catálogo funciona só em modo leitura.

## Hospedar em domínio próprio (opcional)

Os arquivos são estáticos e funcionam em qualquer hospedagem estática (Netlify, Vercel, GitHub Pages) como catálogo de leitura. Para ter a área administrativa fora do claude.ai seria preciso:

1. um backend com login (ex.: Supabase Auth ou Firebase Auth);
2. armazenamento para `catalog.json` e imagens (ex.: Supabase Storage, S3 ou R2);
3. uma função de servidor que chame a API da Anthropic (Messages API, modelo com visão) com a chave guardada no servidor, usando o mesmo prompt de `js/services/classifier.js`;
4. trocar `store.save()` e `classifyImages()` por chamadas a esses serviços. O restante da interface não muda.

## Modelo de dados (`data/catalog.json`)

```json
{
  "categories": [{ "id": "marvel", "name": "Marvel", "keywords": ["herói"], "order": 1 }],
  "products": [{
    "id": "lx-004", "name": "Homem-Aranha — Meia Máscara", "image": "img/cases/lx-004.avif",
    "categories": ["marvel"], "keywords": ["homem-aranha"], "personalizavel": true,
    "description": "…", "sha256": "…", "hidden": false,
    "classification": { "method": "visual", "by": "Claude (análise visual)", "confidence": 0.97, "manual": false }
  }],
  "duplicates": [{ "file": "mockup (32).avif", "duplicateOf": "lx-031" }]
}
```

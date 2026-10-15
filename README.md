# Gerador de Imagens IA Local — Geração de Imagens Sem Censura no Windows

![Gerador de Imagens IA Local — geração de imagens sem censura no Windows](assets/og-image.png)

**Gerador de imagens com IA local sem censura para Windows**, com criação, edição, combinação de imagens, geração de vídeo por IA, galeria, fila, modelos instalados sob demanda e gerenciamento simples pela própria interface.

**Desenvolvido por <a href="https://thall.es" target="_blank" rel="noopener">Thalles Lázaro</a>** • <a href="https://thall.es" target="_blank" rel="noopener">thall.es</a>

<a href="https://youtu.be/YQbrUucNrRE" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/YQbrUucNrRE/maxresdefault.jpg" alt="Assistir ao tutorial: Gerador de Imagens com IA Local Sem Censura (Instalação Fácil no PC)"></a>

**▶ <a href="https://youtu.be/YQbrUucNrRE" target="_blank" rel="noopener">Assistir ao tutorial completo no YouTube</a>**  
**GitHub oficial:** https://github.com/ThallesLazaro/Gerador-de-Imagens-IA-Local

O projeto foi pensado para quem quer usar IA generativa no próprio computador sem precisar montar manualmente vários backends, comandos e pastas de modelos. A instalação do núcleo é simplificada no Windows e os recursos pesados podem ser ativados depois, diretamente pelo navegador.

> **Foco do projeto:** mídia. O chat existe como apoio para prompts e ideias, mas o objetivo principal é gerar, editar e transformar imagens e vídeos localmente.

## Correção 2.7.11 — Validação correta dos executáveis Windows

A validação de `llama-server.exe`, `sd-cli.exe` e outros binários Windows deixou de exigir um tamanho mínimo arbitrário de 64 KB. Alguns executáveis recentes podem ser pequenos porque carregam a implementação principal por DLLs. Agora o projeto valida a estrutura PE real (`MZ`, ponteiro `e_lfanew` e assinatura `PE\0\0`), evitando falsos negativos sem aceitar arquivos que não sejam executáveis PE válidos.

## Correção 2.7.8 — PowerShell e abertura automática

- Corrigido o conflito com a variável automática somente leitura `$Host` no `resources.ps1`.
- O `ABRIR.bat` volta a abrir automaticamente a página do chat assim que o servidor local fica ativo.
- Se o servidor já estiver ativo, o launcher continua abrindo a página do aplicativo automaticamente.


- Corrigido conflito com a variável automática somente leitura `$Host` no `resources.ps1` durante a validação de URLs de download. A variável local agora se chama `$uriHost`.

## Principais recursos

- **Text-to-Image local** com Qwen Image 2.1 Turbo.
- **Geração de imagens sem censura** quando há uma variante compatível disponível no catálogo.
- **Edição de imagens com IA** usando uma imagem de referência.
- **Merge de imagens** com duas ou mais referências.
- **Text-to-Video e Image-to-Video** com motor de vídeo IA compatível.
- **Vídeo leve com FFmpeg** para composições e movimentos simples.
- **Chat local opcional** para ajudar com prompts e ideias.
- **Galeria local** de imagens e vídeos gerados.
- **Fila de geração** para organizar vários pedidos, com limites de segurança para evitar acúmulo excessivo de anexos na memória.
- **Seed reutilizável** para repetir ou variar resultados.
- **Reutilizar geração** restaurando prompt, opções e imagens de referência.
- **Retry automático por falta de memória**, reduzindo a resolução para 75% e depois 50% quando necessário.
- **Mensagens de erro amigáveis** para GPU, Vulkan, RAM, arquivos ausentes e modelos incompatíveis.
- **Progresso e ETA inteligentes**, baseados em etapas reais do backend e histórico de tempo de geração.
- **Logs técnicos completos** com scroll horizontal e sem quebra forçada de linha.
- **Modelos instalados sob demanda**, sem obrigar o usuário a baixar tudo de uma vez.
- **Troca de modelos pela interface**.
- **URLs personalizadas de modelos**.
- **Catálogo editável em `modelos.json`**, sem precisar alterar o código-fonte.
- **Carregar e descarregar o modelo de chat da memória** pela interface.
- **Reutilização de arquivos compartilhados** quando Chat e Imagem usam o mesmo encoder.
- **Q4_K como padrão recomendado** para reduzir falhas de memória em mais computadores.
- Variantes maiores, como Q5_K, Q6_K e Q8_0, continuam disponíveis para quem quiser priorizar qualidade.

### Janelas do Windows

Os arquivos `ABRIR.bat`, `INSTALAR.bat`, `DIAGNOSTICO.bat` e `FECHAR.bat` são os pontos oficiais de entrada no Windows. Eles usam a própria janela do CMD, reduzem o tamanho imediatamente, exibem o nome do projeto, o tutorial oficial e um estado de carregamento antes da ação principal.

> Observação: ao abrir um `.bat` por duplo clique, o Windows cria a janela do console antes da primeira linha do script. Por isso pode existir um flash inicial muito rápido no tamanho padrão do sistema; depois disso, a mesma janela é redimensionada e reutilizada, sem abrir um segundo CMD.


## Experiência, responsividade e acessibilidade

Na versão **2.7.9**, a página do chat recebeu uma auditoria dedicada em desktop grande, notebook, telas de pouca altura, tablet, celular, celular de pouca altura e paisagem. As regras responsivas foram consolidadas para evitar conflitos entre componentes.

Os modais de **Opções** e **Prompt** usam altura natural; **Recursos IA**, **Galeria** e **Fila** também crescem apenas conforme o conteúdo e só passam a rolar quando atingem o limite real da tela. O scroll pertence ao próprio modal, evitando áreas internas espremidas ou múltiplas rolagens concorrentes. Composer, anexos, avisos, cards de mídia, erros, fila, logs e barras de ação também foram verificados sem overflow horizontal da página.

Continuam valendo foco visível para teclado, áreas de toque em telas pequenas, suporte à preferência do sistema por menos movimento, barras de progresso com semântica acessível e rótulos nos botões de fechar.

## Geração de imagens sem censura

Um dos diferenciais do projeto é priorizar **modelos sem censura** quando existe uma variante compatível disponível. A interface identifica a variante escolhida em **Recursos IA** e o catálogo `modelos.json` pode ser editado para trocar modelos e URLs sem alterar o código-fonte.

O comportamento final depende do modelo e do motor selecionados. Nem toda família de modelos possui uma variante sem censura equivalente, por isso o projeto não troca ou rotula automaticamente um modelo sem confirmar essa característica no catálogo.

## Por que este projeto é diferente?

Muitas ferramentas de IA local exigem instalar Python, clonar repositórios, configurar ambientes, baixar modelos manualmente, descobrir nomes de arquivos corretos, ajustar comandos e resolver dependências uma por uma.

O **Gerador de Imagens IA Local** tenta reduzir esse trabalho:

1. execute `INSTALAR.bat` para preparar o núcleo;
2. execute `ABRIR.bat` para abrir a interface;
3. escolha em **Recursos IA** quais motores e modelos deseja instalar.

Os modelos grandes não fazem parte do ZIP do projeto. Eles são baixados somente quando o usuário decide ativá-los.

## Instalação no Windows

### 1. Baixe e extraia o projeto

Extraia a pasta em um local com espaço suficiente para os modelos.

### 2. Execute o instalador

Abra:

```text
INSTALAR.bat
```

O instalador prepara o núcleo e instala o Node.js LTS automaticamente pelo `winget` quando necessário.

### 3. Abra o aplicativo

Execute:

```text
ABRIR.bat
```

O servidor local será iniciado e a interface abrirá automaticamente no navegador.

### 4. Ative os recursos que deseja usar

Na interface, abra **Recursos IA** e escolha entre:

- Chat local;
- Qwen Image;
- Vídeo leve;
- Vídeo IA.

Cada recurso pode ser instalado, reparado ou removido separadamente.

## Modos disponíveis

### Imagem

Cria uma imagem a partir de um prompt de texto.

### Editar

Recebe uma imagem de referência e uma instrução dizendo o que deve ser alterado.

### Juntar

Usa duas ou mais imagens como referências para criar uma nova composição.

### Vídeo

Permite usar um motor de vídeo IA para Text-to-Video ou Image-to-Video. Também existe um modo leve baseado em FFmpeg.

### Conversar

Chat local opcional para ajudar com prompts, ideias e preparação de conteúdo para imagem e vídeo.

## Retry inteligente quando falta memória

Modelos de imagem podem exigir muita memória, principalmente em resoluções maiores, edição e merge com várias referências.

Quando o backend identifica falta de memória da GPU, o projeto pode tentar novamente automaticamente:

1. resolução original;
2. 75% da largura e altura;
3. 50% da largura e altura.

O prompt, a seed, as imagens enviadas e as demais opções são preservados entre as tentativas.

O comportamento pode ser alterado em **Opções → Se faltar memória na GPU**.

## Progresso e previsão de tempo

A porcentagem de geração não depende apenas de um relógio artificial. O frontend acompanha eventos do backend, como:

- carregamento dos modelos;
- processamento do prompt;
- pré-processamento das imagens de referência;
- geração/amostragem;
- decodificação do resultado;
- salvamento;
- geração de frames de vídeo;
- codificação de MP4.

O tempo real de gerações anteriores também é usado para melhorar as próximas estimativas.

Quando uma geração ultrapassa a previsão inicial, a interface não fica presa em `96% • 0s`. Ela passa a informar que está levando mais tempo que o previsto e continua mostrando a etapa real em execução.

## Modelos de IA

O catálogo de modelos fica em:

```text
modelos.json
```

Isso permite trocar URLs, nomes de arquivos, variantes e repositórios sem procurar links espalhados pelo código.

### Qwen Image

O projeto usa o pipeline do Qwen Image com componentes separados quando necessário, incluindo:

- denoiser Qwen Image Turbo;
- encoder Qwen/AtomicChat configurado no catálogo, incluindo variantes sem censura quando disponíveis;
- projetor visual `mmproj` para referências;
- VAE.

O perfil padrão usa quantização **Q4_K**, priorizando compatibilidade e menor consumo de memória. Q5_K, Q6_K e Q8_0 podem ser selecionados manualmente.

### URL personalizada

Usuários avançados também podem informar URLs próprias para modelos compatíveis diretamente em **Recursos IA**.

## Gerenciamento de memória

O projeto tenta evitar manter recursos pesados carregados sem necessidade:

- **Chat:** pode permanecer carregado e pode ser descarregado manualmente.
- **Imagem:** é executada sob demanda.
- **Vídeo IA:** é executado sob demanda.
- **FFmpeg:** é chamado apenas quando necessário.
- **Resultados finais:** ficam em `outputs/` e não são duplicados como arquivos completos no IndexedDB.
- **Histórico:** mantém metadados leves, possui backup local no próprio projeto e carrega anexos originais apenas quando uma ação realmente precisa deles.
- **Referências reutilizáveis:** novas imagens de referência são deduplicadas por SHA-256 no IndexedDB, evitando guardar várias cópias do mesmo arquivo.
- **Fila:** limita quantidade e volume de anexos para impedir que vários merges grandes ocupem memória indefinidamente.
- **Temporários:** `uploads/` e `temp/` são limpos na inicialização quando não existe trabalho ativo.

Na aba **Recursos IA**, o usuário pode verificar qual modelo está selecionado e o estado do recurso.

## Galeria e histórico

A conversa abre diretamente nas mensagens mais recentes. Para não renderizar centenas de imagens e vídeos de uma vez, o histórico usa **carregamento progressivo reverso**: inicialmente entram apenas as 24 mensagens mais recentes e, ao subir até o topo, o lote anterior é carregado automaticamente sem deslocar a leitura. As mensagens fora da área visível também usam otimizações de renderização do navegador.

Os arquivos finais ficam na pasta `outputs/`. O IndexedDB guarda metadados e, quando necessário, as imagens de referência usadas para permitir reutilização. Novas gerações não duplicam o arquivo final inteiro dentro do IndexedDB.

A partir da versão **2.7.4**, a persistência usa camadas de recuperação complementares:

- a conversa continua rápida no `localStorage`, mas também recebe backup em `data/history.json`;
- cada PNG/MP4 novo recebe um pequeno arquivo `.meta.json` em `outputs/` com prompt, seed, modo, resolução e opções relevantes;
- ao iniciar e ao abrir a Galeria, o aplicativo reconcilia o IndexedDB com os arquivos físicos;
- arquivos presentes em `outputs/` sem registro no navegador são recuperados automaticamente;
- resultados parciais/corrompidos deixados por uma interrupção brusca são ignorados e, quando pertencem ao padrão de saída do projeto, removidos antes de voltarem para a Galeria;
- registros cujo arquivo físico realmente desapareceu são removidos da Galeria e do histórico;
- itens antigos que ainda possuem um Blob completo no IndexedDB são preservados mesmo se o arquivo físico tiver sido apagado;
- referências de entrada iguais são armazenadas uma única vez, com deduplicação por SHA-256 e contagem de uso;
- a reconciliação recalcula essas contagens e elimina Blobs de referência órfãos que não pertencem mais a nenhuma geração;
- o backup da conversa é atualizado também ao ocultar/fechar a página e usa uma revisão monotônica para impedir que uma aba ou requisição atrasada sobrescreva um histórico mais novo;
- o aplicativo solicita armazenamento persistente ao navegador quando esse recurso está disponível.

Se os dados do navegador forem apagados, resultados novos com `.meta.json` podem recuperar também prompt, seed, dimensões, duração/FPS e motor de vídeo. Arquivos antigos sem metadados continuam recuperáveis, mas podem aparecer com informações reduzidas.

A galeria organiza as gerações locais e permite:

- pesquisar por prompt;
- filtrar imagens e vídeos;
- reutilizar uma geração;
- recuperar imagens de referência utilizadas;
- usar a mesma seed;
- editar uma imagem gerada;
- transformar uma imagem em vídeo;
- excluir resultados.

## Estrutura do projeto

```text
Gerador-de-Imagens-IA-Local/
├── index.html
├── projeto.json
├── assets/
├── data/                 # backup local do histórico
├── ABRIR.bat
├── INSTALAR.bat
├── FECHAR.bat
├── DIAGNOSTICO.bat
├── modelos.json
├── model-config.json
├── config.json
├── server.js
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── scripts/
│   ├── header.ps1
│   ├── footer.ps1
│   ├── launcher.ps1
│   ├── diagnostico.ps1
│   ├── resources.ps1
│   └── video_runner.py
├── models/
├── outputs/
├── runtime/
└── uploads/
```

## Arquivos importantes

| Arquivo | Função |
|---|---|
| `INSTALAR.bat` | Prepara o núcleo do projeto no Windows |
| `ABRIR.bat` | Inicia o servidor e abre a interface |
| `FECHAR.bat` | Encerra o servidor local |
| `DIAGNOSTICO.bat` | Verifica componentes e backends instalados |
| `modelos.json` | Catálogo editável de modelos e URLs |
| `model-config.json` | Guarda as variantes atualmente selecionadas |
| `config.json` | Configurações gerais do servidor e padrões |

## Backends e tecnologias

O projeto é construído com tecnologias simples e locais:

- Node.js;
- Express;
- HTML, CSS e JavaScript;
- IndexedDB e `localStorage` para histórico local;
- `stable-diffusion.cpp` para o pipeline de imagem;
- `llama.cpp` para o chat local;
- FFmpeg para vídeo e pós-processamento;
- Python/Diffusers para motores de vídeo IA compatíveis;
- GGUF para modelos quantizados quando aplicável.

## Requisitos

- Windows 10 ou Windows 11;
- Node.js 18 ou superior (o `INSTALAR.bat` tenta instalar/atualizar automaticamente pelo WinGet quando necessário);
- espaço em disco suficiente para os modelos escolhidos;
- memória RAM e GPU compatíveis com a quantização e resolução utilizadas;
- internet durante a instalação dos backends e modelos.

Depois que os recursos necessários estão instalados, a geração é executada localmente pelos motores configurados.

## Modelos maiores e memória

Q8_0 e outras variantes maiores podem exigir significativamente mais memória que Q4_K. O projeto não bloqueia essas opções: ele apenas deixa Q4_K como padrão e apresenta mensagens de diagnóstico quando o backend não consegue reservar memória suficiente.

Para reduzir consumo, experimente:

- resolução menor;
- Q4_K ou Q5_K;
- fechar aplicativos que usam GPU;
- descarregar o chat antes de uma geração pesada;
- reduzir o tamanho das imagens de referência.

## Segurança local

O servidor do aplicativo é iniciado somente em `127.0.0.1` e não é exposto para a rede local por padrão. A partir da versão **2.7.5**, o backend também valida `Host` e `Origin`, bloqueia requisições `cross-site` para APIs/arquivos de saída e exige um cabeçalho local específico em qualquer ação que altere estado. Isso reduz ataques de CSRF e DNS rebinding vindos de páginas abertas no navegador.

Outras proteções aplicadas:

- arquivos em `outputs/` só são servidos quando são `.png` ou `.mp4` válidos; arquivos auxiliares `.meta.json` não ficam públicos;
- uploads aceitam somente PNG, JPEG, WebP, GIF ou BMP, com validação do MIME e da assinatura real do arquivo;
- caminhos usados pelo backend são confinados à pasta do projeto e tentativas com `../` ou caminho absoluto externo são bloqueadas;
- URLs personalizadas remotas precisam usar HTTPS; HTTP é aceito somente em `localhost`/`127.0.0.1`;
- nomes de arquivos/pastas usados pelo instalador são validados antes de download, remoção ou extração;
- ZIP/7z são inspecionados antes da extração para bloquear caminhos internos com traversal;
- prompts são enviados aos executáveis como argumentos separados, sem `shell:true` ou concatenação em comandos;
- a interface recebe CSP, `nosniff`, bloqueio de iframe e políticas de origem adequadas ao uso local.

**Limite desta proteção:** releases e modelos baixados dinamicamente continuam dependendo da segurança das fontes externas usadas no catálogo. O projeto valida formato, tamanho/estrutura e transporte HTTPS, mas não fixa hashes criptográficos de cada release dinâmica. Para máxima reprodutibilidade, uma versão futura pode piná-los por versão e SHA-256.

## Diagnóstico de erros

Em vez de mostrar apenas um código de saída, a interface tenta reconhecer erros conhecidos e explicar a causa provável.

Exemplos:

- memória da GPU insuficiente;
- memória RAM insuficiente;
- espaço em disco insuficiente;
- falha Vulkan;
- modelo incompatível;
- arquivo ou runtime ausente;
- upload inválido ou acima de 60 MB por imagem;
- resultado PNG/MP4 incompleto ou corrompido;
- servidor local indisponível;
- instalação interrompida ou conexão perdida durante a instalação;
- falha no ambiente Python de vídeo;
- falha na inicialização ou resposta do Chat local.

A partir da versão 2.7.3, respostas inválidas do backend e arquivos de saída incompletos são rejeitados antes de aparecerem como sucesso. Se a geração terminar corretamente mas o armazenamento local do navegador falhar, o arquivo criado continua disponível na conversa para visualização e download, com um aviso de que ele não pôde ser registrado na Galeria.

O log técnico continua disponível para diagnóstico detalhado.

## Perguntas frequentes

### Os modelos vêm dentro do ZIP?

Não. O núcleo é pequeno e os modelos são instalados sob demanda pela interface.

### Preciso configurar comandos manualmente?

Na utilização normal, não. O objetivo do projeto é automatizar a instalação e o uso dos backends no Windows.

### Posso usar outro modelo?

Sim. O catálogo `modelos.json` pode ser editado e a interface também aceita variantes e URLs personalizadas compatíveis.

### Funciona sem placa NVIDIA?

O projeto inclui suporte a backends que podem usar Vulkan e CPU. O desempenho e a compatibilidade dependem do modelo, driver e hardware disponível.

### Posso gerar imagens em Q8_0?

Sim. Q8_0 continua disponível, mas exige mais memória. Q4_K é o padrão recomendado para aumentar a compatibilidade.

### O programa reduz a resolução sozinho?

Somente quando a opção de retry automático está ativada e o erro é reconhecido como falta de memória da GPU. O usuário pode desativar esse comportamento.

## Objetivo do projeto

Criar uma ferramenta de **geração de imagens IA local no Windows** que seja simples de instalar e usar, mas sem esconder opções avançadas de modelos, qualidade, referências, vídeo e diagnóstico.

O projeto prioriza uma experiência visual semelhante a ferramentas modernas de IA, porém com os motores rodando localmente e com controle direto sobre os modelos instalados.

---

**Gerador de Imagens IA Local** — geração, edição e vídeo com IA local em uma interface simples para Windows.

### Vídeo IA baixado, mas ainda aparece como não instalado

A partir da versão 2.7.2, o aplicativo faz uma validação mais rigorosa do Vídeo IA. Para o recurso aparecer como instalado, ele confirma o ambiente Python 3.11 validado, as bibliotecas do runner LTX, o `model_index.json` do pipeline, arquivos reais de pesos e o repositório associado ao marcador `.gerador-video-installed.json`.

Se você estiver vindo de uma versão anterior e o Vídeo IA aparecer como não instalado, abra **Recursos IA** e use **Reparar / aplicar** uma vez. O modelo já baixado é reaproveitado quando pertence ao mesmo repositório; o processo valida/ajusta apenas o que estiver faltando. As dependências principais do runner ficam controladas em `scripts/video-requirements.txt` para reduzir quebras causadas por atualizações futuras.


## Links oficiais

- **Repositório:** https://github.com/ThallesLazaro/Gerador-de-Imagens-IA-Local
- **Tutorial em vídeo:** <a href="https://youtu.be/YQbrUucNrRE" target="_blank" rel="noopener">https://youtu.be/YQbrUucNrRE</a>

A landing page pública da raiz usa `projeto.json` para manter os links principais centralizados.


## Desenvolvedor

O **Gerador de Imagens IA Local** foi criado e é mantido por **<a href="https://thall.es" target="_blank" rel="noopener">Thalles Lázaro</a>**.

- Site: <a href="https://thall.es" target="_blank" rel="noopener">https://thall.es</a>
- GitHub: https://github.com/ThallesLazaro



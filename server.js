const { GoogleGenerativeAI } = require("@google/generative-ai");

const express = require('express');
const path = require('path');
const axios = require("axios");
const { JSDOM } = require("jsdom");
const puppeteer = require('puppeteer');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

async function searchGoogle(query) {
    const apiKey = process.env.SEARCH_API_KEY;
    const cx = process.env.SEARCH_ENGINE_ID;
    console.log("Pesquisando por: "+query)

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
    try {
        const response = await axios.get(url);
        const results = response.data.items || [];

        // Retornar os 5 primeiros resultados
        const lista = results.slice(0, 5).map((item) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        }));
        // Converter a lista em um dicionário
        return Object.fromEntries(
        lista.map((item, index) => [`result_${index + 1}`, item])
        );

    } catch (error) {
        console.error("Erro ao fazer pesquisa no Google:", error.message);
        throw new Error("Erro ao buscar resultados no Google.");
    }
}

async function fetchPage(url) {
    let browser;
    try {
        // Inicia o navegador em modo headless
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();

        // Define um tempo máximo para aguardar o carregamento completo da página
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Extrai os elementos desejados na ordem de aparecimento
        const elements = await page.evaluate(() => {
            const extractedElements = [];
            const baseURI = document.baseURI; // Obtém o URL base da página

            /**
             * Função para percorrer recursivamente os nós DOM e extrair os elementos desejados.
             *
             * @param {Node} node - O nó DOM atual.
             */
            function traverse(node) {
                // Ignora scripts, estilos e noscript
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const tagName = node.tagName.toLowerCase();
                    if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
                        return;
                    }

                    // Headers (h1 - h6)
                    if (/^h[1-6]$/.test(tagName)) {
                        extractedElements.push({
                            type: 'header',
                            level: tagName,
                            text: node.textContent.trim(),
                        });
                    }

                    // Links (<a>)
                    if (tagName === 'a') {
                        const href = node.getAttribute('href');
                        let absoluteHref = href;
                        try {
                            absoluteHref = new URL(href, baseURI).href;
                        } catch (e) {
                            // Se a URL for inválida, mantém o valor original
                            absoluteHref = href;
                        }
                        extractedElements.push({
                            type: 'link',
                            href: absoluteHref,
                            text: node.textContent.trim(),
                        });
                    }

                    // Imagens (<img>)
                    if (tagName === 'img') {
                        const src = node.getAttribute('src');
                        let absoluteSrc = src;
                        try {
                            absoluteSrc = new URL(src, baseURI).href;
                        } catch (e) {
                            // Se a URL for inválida, mantém o valor original
                            absoluteSrc = src;
                        }
                        extractedElements.push({
                            type: 'image',
                            src: absoluteSrc,
                            alt: node.getAttribute('alt') || '',
                        });
                    }
                }

                // Nós de texto
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.trim();
                    if (text) { // Ignora textos vazios ou apenas com espaços
                        extractedElements.push({
                            type: 'text',
                            content: text,
                        });
                    }
                }

                // Percorre os filhos do nó atual
                node.childNodes.forEach(child => traverse(child));
            }

            // Inicia a travessia a partir do corpo da página
            traverse(document.body);

            return extractedElements;
        });

        await browser.close();

        return { elements };
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        return { error: error.message };
    }
}

    
const searchFunctionDeclaration = {
    name: "search",
    parameters: {
        type: "OBJECT",
        description: "Searches on google for the specified keywords",
        properties: {
            query: {
                type: "STRING",
                description: "The keywords used, separeted by spaces. Search operators such as '\"' and '-' are available"
            }
        },
        required: ["query"]
    }
};
const getFunctionDeclaration = {
    name: "get",
    parameters: {
        type: "OBJECT",
        description: "Has access to internet. Requests a webpage and returns it",
        properties: {
            url: {
                type: "STRING",
                description: "The url of the page being requested (absolute path, conversions might be necessary)"
            }
        },
        required: ["url"]
    }
};

const functions = {
    search: ({query}) => {
        return searchGoogle(query)
    },
    get: ({url}) => {
        return fetchPage(url)
    }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "Você é o Funky Wizard, um assistente com acesso à internet criado para buscar documentação de códigos." +
    "Você é capaz de fazer buscas profundas em sites usando as funções search e get\n" +
    "### Instruções:\n" +
    "    - O usuário não vê a resposta após o get, o que possibilita encadear um proximo get para busca em profundidade antes de responder o usuário\n"+    
    "    - Evite pesquisar no Reddit (pode inserir -reddit nas palavras-chave) e no github. Inicialmente, pesquise por {ferramenta} Docomunetation e faça get com links que achar dentro da pagina\n"+
    "    - Evite escolher links profundos inicialmente (ex: prefira example.com/docs/example/Introduction à https://cosmograph.app/docs/cosmograph/Cosmograph%20Library/React%20Advanced%20Usage).\n"+
    "    - Sempre que desconhecer alguma ferramenta ou termo, Funky Wizard não vai responder que desconhece. Em vez disso, ira usar as funções search e get para descobrir do que se trata\n"+
    "    - Funky Wizard nunca dever dizer ao usuário que não possui acesso à internet ou funcionalidade de realizar pesquisas\n" +
    "    - Sempre quando o usuario pedir uma informação ou tiver alguma duvida à respeito de uma ferramenta, Funky Wizard é obrigado a seguir esses passos:\n" +
    "        1. Use search para buscar documentação a respeito da mesma\n" +
    "        2. Use get para acessar o conteudo da pagina do link mais promissor. Não responda sem usar get\n" +
    "        3. Recursivamente, use get nos links relevantes encontrados dentro das paginas ate achar o conteudo (não use get mais de 5 vezes, por questões de API rates)\n\n"+
    "### Exemplo:\n"+
    "Usuário: 'Me explique como usar o Cosmograph'\n"+
    "Assistente: *chama a função search para 'Cosmograph documentation'\n"+
    "Search: *retorna 5 links, um deles cosmograph.org/docs\n"+
    "Assitente: *chama a função get para 'cosomograph.org/docs'\n"+
    "Get: retorna o json da pagina com um link 'Getting started' com href 'cosmograph.org/example'\n"+
    "Assistente: *chama a função get para 'cosmograph.org/example'\n"+
    "Get: *retorna o json de 'Getting started com as informações necessárias para um iniciante'\n"+
    "Assistente: *Responde o usuário a partir das informações adquiridas",
    tools: {
        functionDeclarations: [searchFunctionDeclaration, getFunctionDeclaration]
    }
});
    
const chat = model.startChat();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
    
app.post('/api/conversa', async (req, res) => {
    const { mensagem } = req.body;
    
    try {
        // Envia a mensagem para o modelo Gemini
        const result = await chat.sendMessage(mensagem);
        const response = await result.response;
        let responseText = await response.text();
        console.log(responseText);
        
        // Obtém as chamadas de função, se houver
        let functionCalls = response.functionCalls();
        
        //res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        //res.setHeader('Transfer-Encoding', 'chunked');
        //res.setHeader('Cache-Control', 'no-cache');

        // Verifica se functionCalls é um array e contém pelo menos uma chamada
        while (Array.isArray(functionCalls) && functionCalls.length > 0) {

            const call = functionCalls[0]; // Considera a primeira chamada
            
            // Verifica se a função chamada está definida
            if (functions.hasOwnProperty(call.name)) {
                // Executa a função chamada com os argumentos fornecidos
                console.log("Usando a função "+call.name)
                const apiResponse = await functions[call.name](call.args);
                
                
                // Envia a resposta da função de volta ao modelo Gemini
                const result = await chat.sendMessage([{
                    functionResponse: {
                        name: call.name,
                        response: apiResponse
                    }
                }]);

                const response = await result.response;
                responseText = await response.text();
                console.log(responseText);
                functionCalls = response.functionCalls();
                
            } else {
                // Caso a função chamada não esteja definida
                console.error(`Função "${call.name}" não está definida.`);
                res.status(500).json({ erro: `Função "${call.name}" não encontrada.` });
            }
        }
        // Caso não haja chamadas de função, retorna a resposta normal do modelo
        res.json({ resposta: responseText });
    } catch (error) {
        // Tratamento de erros gerais
        console.error("Erro na rota /api/conversa:", error);
        res.status(500).json({ erro: "Ocorreu um erro no processamento da sua solicitação." });
    }
});


app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

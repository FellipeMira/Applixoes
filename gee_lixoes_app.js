/**
 * ========================================
 * Aplicativo GEE - Análise de Probabilidade de Lixões
 * ========================================
 *
 * Visualização interativa com filtros por estado/município e métricas agregadas
 *
 * MELHORIAS IMPLEMENTADAS:
 * ────────────────────────
 *
 * 1. BASEMAP HÍBRIDO
 *    - Alterado para visualização satélite + labels
 *    - Melhor contexto geoespacial
 *
 * 2. DESTAQUE PARA ALTA PROBABILIDADE
 *    - Polígonos de alta probabilidade (>89%) com:
 *      • Borda mais espessa (3px)
 *      • Maior opacidade (90%)
 *      • Cor de borda escura (#B71C1C)
 *
 * 3. NOVA PALETA RASTER
 *    - Gradiente: Azul escuro → Azul → Verde → Amarelo → Vermelho
 *    - Opacidade ajustada (60%) para basemap híbrido
 *
 * 4. ESTÉTICA APRIMORADA
 *    - Títulos com maior contraste e visibilidade
 *    - Fontes aumentadas e com família especificada
 *    - Botões com melhor definição e cores
 *    - Ícones emoji para melhor UX
 *
 * 5. HEADER PRINCIPAL
 *    - Header fixo no topo do app
 *    - Título centralizado e proeminente
 *
 * 6. FOOTER COM LOGOS
 *    - Seção de apoiadores no rodapé do sidebar
 *    - Instruções para adicionar logos reais
 *
 * 7. AJUSTES TÉCNICOS ESPECIALIZADOS
 *    - Painel de informações técnicas do sistema
 *    - Legenda aprimorada (polígonos + raster)
 *    - Indicador de carregamento
 *    - Controles de mapa otimizados
 *    - Popup de informações com fundo colorido por categoria
 *    - Sidebar com scroll automático
 *    - Bordas destacadas nos painéis
 *
 * ========================================
 */

// ===========================
// CONFIGURAÇÕES E CONSTANTES
// ===========================

var CONFIG = {
  // Assets
  rasterFolder: 'projects/ee-lixoes/assets/FINAL_RESULTS_BIN',
  vectorAsset: 'projects/lixoes-467518/assets/resultsVect/MEDIAN_IMPROVED_THRESHOLDS_70_MIN_AREAS_1000_SCIKIT_ALL_METRICS_V6',
  
  // Visualização
  probabilityPalette: ['#050220', '#0f567f', '#1e90ff', '#6dc07a', '#efff36', '#FF0000'], // Nova paleta fornecida
  mapCenter: {lon: -47.93, lat: -15.78}, // Centro do Brasil
  mapZoom: 4,
  baseMap: 'HYBRID', // Basemap híbrido (satélite + labels)
  
  // Faixas de probabilidade
  probabilityRanges: {
    baixa: [0, 0.75],
    media: [0.75, 0.89],
    alta: [0.89, 1.0]
  }
};

// ===========================
// CARREGAMENTO DE DADOS
// ===========================

/**
 * Carrega e processa os dados raster
 */
function loadRasterData() {
  var assetList = ee.data.listAssets(CONFIG.rasterFolder);
  
  function loadImages(assetList) {
    return assetList.assets.map(function(asset) {
      return ee.Image(asset.name);
    });
  }
  
  var imageCollection = ee.ImageCollection(loadImages(assetList));
  var mosaic = imageCollection.mosaic();
  
  // Garantir valores entre 0 e 1
  mosaic = mosaic.clamp(0, 1);
  
  return mosaic;
}

/**
 * Carrega dados vetoriais
 */
function loadVectorData() {
  return ee.FeatureCollection(CONFIG.vectorAsset);
}

// ===========================
// PROCESSAMENTO DE DADOS
// ===========================

/**
 * Detecta quais colunas de probabilidade existem no vetor
 */
function detectProbabilityColumns(vectorData) {
  var first = ee.Feature(vectorData.first());
  var properties = first.propertyNames();
  
  var possibleColumns = ['prob_media', 'prob_mean', 'prob_max'];
  var availableColumns = [];
  
  possibleColumns.forEach(function(col) {
    if (properties.contains(col).getInfo()) {
      availableColumns.push(col);
    }
  });
  
  return availableColumns;
}

/**
 * Obtém lista única de estados
 */
function getUniqueStates(vectorData) {
  var states = vectorData.aggregate_array('uf').distinct();
  return states.sort().getInfo();
}

/**
 * Obtém municípios de um estado
 */
function getMunicipalities(vectorData, state) {
  var filtered = vectorData.filter(ee.Filter.eq('uf', state));
  var municipalities = filtered.aggregate_array('muni_name').distinct();
  return municipalities.sort().getInfo();
}

/**
 * Calcula estatísticas por faixa de probabilidade
 */
function calculateStatsByRange(features, probColumn) {
  var ranges = CONFIG.probabilityRanges;
  var stats = {};
  
  Object.keys(ranges).forEach(function(range) {
    var min = ranges[range][0];
    var max = ranges[range][1];
    
    var count = features.filter(
      ee.Filter.and(
        ee.Filter.gte(probColumn, min),
        ee.Filter.lt(probColumn, max)
      )
    ).size();
    
    stats[range] = count.getInfo();
  });
  
  return stats;
}

/**
 * Calcula estatísticas por UF
 */
function calculateStatsByState(vectorData, probColumn) {
  var states = getUniqueStates(vectorData);
  var stats = {};
  
  states.forEach(function(state) {
    var stateFeatures = vectorData.filter(ee.Filter.eq('uf', state));
    var count = stateFeatures.size().getInfo();
    var avgProb = stateFeatures.aggregate_mean(probColumn).getInfo();
    
    stats[state] = {
      count: count,
      avgProbability: avgProb
    };
  });
  
  return stats;
}

// ===========================
// ESTILIZAÇÃO
// ===========================

/**
 * Estilo para features vetoriais por probabilidade
 * Usa as faixas definidas em CONFIG.probabilityRanges
 * DESTAQUE para polígonos de ALTA probabilidade
 */
function getFeatureStyle(feature, probColumn) {
  var prob = ee.Number(feature.get(probColumn));

  // Paleta de cores baseada nas faixas de probabilidade
  // Baixa (0-0.75): Verde - #4CAF50
  // Média (0.75-0.89): Laranja - #FF9800
  // Alta (0.89-1.0): Vermelho - #F44336 (COM DESTAQUE)

  // Cor de preenchimento
  var fillColor = ee.Algorithms.If(
    prob.lt(0.75), '#4CAF50',
    ee.Algorithms.If(
      prob.lt(0.89), '#FF9800',
      '#F44336'  // Vermelho intenso para alta probabilidade
    )
  );

  // Cor da borda - destaque para alta probabilidade
  var borderColor = ee.Algorithms.If(
    prob.lt(0.75), '#2E7D32',  // Verde escuro
    ee.Algorithms.If(
      prob.lt(0.89), '#E65100',  // Laranja escuro
      '#B71C1C'  // Vermelho muito escuro para destaque
    )
  );

  // Espessura da borda - maior para alta probabilidade
  var borderWidth = ee.Algorithms.If(
    prob.lt(0.75), 1.5,
    ee.Algorithms.If(
      prob.lt(0.89), 2,
      3  // Borda mais grossa para alta probabilidade
    )
  );

  // Opacidade - maior para alta probabilidade
  var fillOpacity = ee.Algorithms.If(
    prob.lt(0.75), 0.65,
    ee.Algorithms.If(
      prob.lt(0.89), 0.75,
      0.90  // Maior opacidade para alta probabilidade
    )
  );

  return feature.set({
    style: {
      color: borderColor,
      fillColor: fillColor,
      width: borderWidth,
      fillOpacity: fillOpacity
    }
  });
}

/**
 * Aplica estilo ao vetor
 */
function styleVector(vectorData, probColumn) {
  return vectorData.map(function(feature) {
    return getFeatureStyle(feature, probColumn);
  });
}

// ===========================
// INTERFACE DO USUÁRIO
// ===========================

// Elementos principais
var mainPanel = ui.Panel({
  layout: ui.Panel.Layout.flow('horizontal'),
  style: {width: '100%', height: '100%'}
});

var sidePanel = ui.Panel({
  style: {
    width: '440px',  // Aumentado ligeiramente
    padding: '15px',
    backgroundColor: '#f5f7fa',
    maxHeight: '100%',
    overflow: 'auto'  // Scroll se necessário
  }
});

var mapPanel = ui.Map();
mapPanel.setCenter(CONFIG.mapCenter.lon, CONFIG.mapCenter.lat, CONFIG.mapZoom);
mapPanel.setOptions(CONFIG.baseMap); // Configurar basemap híbrido
mapPanel.style().set('cursor', 'crosshair');

// Configurações avançadas do mapa
mapPanel.setControlVisibility({
  all: false,
  layerList: true,      // Controle de camadas
  zoomControl: true,    // Controle de zoom
  scaleControl: true,   // Escala
  mapTypeControl: true, // Seletor de basemap
  fullscreenControl: false
});

// ===========================
// CONSTRUÇÃO DA UI
// ===========================

/**
 * Cria cabeçalho do aplicativo
 * Melhorado para garantir boa renderização e visibilidade
 */
function createHeader() {
  var header = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#1a252f',  // Azul muito escuro para contraste
      padding: '24px 20px',
      margin: '0 0 15px 0',
      border: '3px solid #34495e',  // Borda sutil para definição
      stretch: 'horizontal'
    }
  });

  var title = ui.Label('🗺️ Análise de Probabilidade de Lixões', {
    fontSize: '26px',           // Aumentado para melhor visibilidade
    fontWeight: 'bold',
    color: '#FFFFFF',           // Branco puro para máximo contraste
    margin: '0 0 10px 0',
    textAlign: 'center',
    stretch: 'horizontal',
    fontFamily: 'Roboto, Arial, sans-serif'  // Fonte legível
  });

  var subtitle = ui.Label('Sistema de Monitoramento e Análise Espacial', {
    fontSize: '15px',           // Aumentado
    color: '#E8F4F8',           // Azul muito claro
    fontStyle: 'italic',
    textAlign: 'center',
    stretch: 'horizontal',
    fontFamily: 'Roboto, Arial, sans-serif'
  });

  header.add(title);
  header.add(subtitle);

  return header;
}

/**
 * Cria seção de filtros
 */
function createFilterSection(vectorData, probColumns) {
  var filterPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '2px solid #3498db'  // Borda mais visível
    }
  });

  filterPanel.add(ui.Label('🔎 Filtros Espaciais', {
    fontWeight: 'bold',
    fontSize: '17px',
    color: '#2c3e50',
    margin: '0 0 12px 0'
  }));

  // Filtro de estado
  var stateLabel = ui.Label('Estado (UF):', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var states = ['Todos'].concat(getUniqueStates(vectorData));
  var stateSelect = ui.Select({
    items: states,
    value: 'Todos',
    style: {width: '100%', margin: '0 0 10px 0'}
  });

  // Filtro de município
  var muniLabel = ui.Label('Município:', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var muniSelect = ui.Select({
    items: ['Todos'],
    value: 'Todos',
    style: {width: '100%', margin: '0 0 10px 0'},
    disabled: true
  });

  // Campo de busca de município
  var muniSearchLabel = ui.Label('Buscar município:', {
    fontSize: '13px',
    color: '#555',
    margin: '8px 0 4px 0'
  });
  var muniSearchBox = ui.Textbox({
    placeholder: 'Digite para buscar...',
    style: {width: '100%', margin: '0 0 10px 0'},
    disabled: true
  });
  
  // Atualizar municípios quando estado mudar
  stateSelect.onChange(function(state) {
    if (state === 'Todos') {
      muniSelect.items().reset(['Todos']);
      muniSelect.setDisabled(true);
      muniSearchBox.setDisabled(true);
    } else {
      var municipalities = ['Todos'].concat(getMunicipalities(vectorData, state));
      muniSelect.items().reset(municipalities);
      muniSelect.setDisabled(false);
      muniSearchBox.setDisabled(false);
    }
    muniSelect.setValue('Todos');
    updateVisualization();
  });
  
  // Busca de município
  muniSearchBox.onChange(function(text) {
    if (text && stateSelect.getValue() !== 'Todos') {
      var state = stateSelect.getValue();
      var allMunis = getMunicipalities(vectorData, state);
      var filtered = allMunis.filter(function(muni) {
        return muni.toLowerCase().indexOf(text.toLowerCase()) !== -1;
      });
      muniSelect.items().reset(['Todos'].concat(filtered));
    }
  });

  filterPanel.add(stateLabel);
  filterPanel.add(stateSelect);
  filterPanel.add(muniLabel);
  filterPanel.add(muniSelect);
  filterPanel.add(muniSearchLabel);
  filterPanel.add(muniSearchBox);
  
  // Botão aplicar filtros - melhorado para visibilidade
  var applyButton = ui.Button({
    label: '🔍 Aplicar Filtros',
    style: {
      width: '100%',
      margin: '15px 0 5px 0',
      backgroundColor: '#2980b9',  // Azul mais escuro
      color: '#FFFFFF',             // Branco puro
      padding: '12px',              // Aumentado
      fontSize: '15px',             // Tamanho de fonte explícito
      fontWeight: 'bold',           // Negrito
      border: '2px solid #1a5490',  // Borda para definição
      textAlign: 'center'
    },
    onClick: updateVisualization
  });

  filterPanel.add(applyButton);

  return {
    panel: filterPanel,
    stateSelect: stateSelect,
    muniSelect: muniSelect
  };
}

/**
 * Cria painel de informações técnicas
 */
function createInfoPanel() {
  var infoPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#e8f4f8',
      padding: '15px',
      margin: '0 0 15px 0',
      border: '2px solid #3498db'
    }
  });

  infoPanel.add(ui.Label('ℹ️ Informações do Sistema', {
    fontWeight: 'bold',
    fontSize: '14px',
    color: '#1a5490',
    margin: '0 0 10px 0'
  }));

  infoPanel.add(ui.Label('🔹 Basemap: Híbrido (Satélite + Labels)', {
    fontSize: '12px',
    color: '#34495e',
    margin: '3px 0'
  }));

  infoPanel.add(ui.Label('🔹 Resolução: Multi-escala', {
    fontSize: '12px',
    color: '#34495e',
    margin: '3px 0'
  }));

  infoPanel.add(ui.Label('🔹 Modelo: Machine Learning (Scikit-learn)', {
    fontSize: '12px',
    color: '#34495e',
    margin: '3px 0'
  }));

  infoPanel.add(ui.Label('🔹 Destaque: Áreas de ALTA probabilidade', {
    fontSize: '12px',
    color: '#e74c3c',
    fontWeight: 'bold',
    margin: '3px 0'
  }));

  return infoPanel;
}

/**
 * Cria painel de métricas
 */
function createMetricsPanel() {
  var metricsPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#ffffff',
      padding: '18px',
      margin: '0 0 15px 0',
      border: '2px solid #3498db'  // Borda mais visível
    }
  });

  metricsPanel.add(ui.Label('📈 Métricas', {
    fontWeight: 'bold',
    fontSize: '17px',
    color: '#2c3e50',
    margin: '0 0 12px 0'
  }));

  // Placeholders para métricas
  var totalLabel = ui.Label('Total de ocorrências: -', {
    fontSize: '13px',
    color: '#555',
    margin: '4px 0'
  });
  var avgProbLabel = ui.Label('Probabilidade média: -', {
    fontSize: '13px',
    color: '#555',
    margin: '4px 0 12px 0'
  });

  var rangePanel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      margin: '12px 0 0 0',
      padding: '12px',
      backgroundColor: '#f8f9fa',
      border: '1px solid #e9ecef'
    }
  });

  rangePanel.add(ui.Label('Por faixa de probabilidade:', {
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#2c3e50',
    margin: '0 0 8px 0'
  }));
  var lowLabel = ui.Label('🟢 Baixa (0-75%): -', {
    fontSize: '13px',
    color: '#4CAF50',
    margin: '4px 0'
  });
  var medLabel = ui.Label('🟠 Média (75-89%): -', {
    fontSize: '13px',
    color: '#FF9800',
    margin: '4px 0'
  });
  var highLabel = ui.Label('🔴 Alta (89-100%): -', {
    fontSize: '13px',
    color: '#F44336',
    margin: '4px 0'
  });
  
  rangePanel.add(lowLabel);
  rangePanel.add(medLabel);
  rangePanel.add(highLabel);
  
  metricsPanel.add(totalLabel);
  metricsPanel.add(avgProbLabel);
  metricsPanel.add(rangePanel);
  
  return {
    panel: metricsPanel,
    totalLabel: totalLabel,
    avgProbLabel: avgProbLabel,
    lowLabel: lowLabel,
    medLabel: medLabel,
    highLabel: highLabel
  };
}

/**
 * Cria legenda aprimorada para o mapa
 * Inclui legendas para polígonos E raster
 */
function createLegend() {
  var legend = ui.Panel({
    style: {
      position: 'bottom-right',
      padding: '15px 20px',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',  // Fundo semi-transparente
      border: '3px solid #2c3e50'
    }
  });

  // Título principal
  legend.add(ui.Label('📊 Legenda', {
    fontWeight: 'bold',
    fontSize: '16px',
    color: '#1a252f',
    margin: '0 0 12px 0'
  }));

  // Seção Polígonos
  legend.add(ui.Label('Polígonos (Vetorial):', {
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#2c3e50',
    margin: '5px 0 8px 0'
  }));

  // Três faixas de probabilidade para polígonos
  var ranges = [
    {color: '#4CAF50', label: 'Baixa (0-75%)', icon: '🟢'},
    {color: '#FF9800', label: 'Média (75-89%)', icon: '🟠'},
    {color: '#F44336', label: 'Alta (89-100%)', icon: '🔴', highlight: true}
  ];

  ranges.forEach(function(range) {
    var colorBox = ui.Label('', {
      backgroundColor: range.color,
      padding: range.highlight ? '14px' : '12px',  // Maior para alta prob
      margin: '0 8px 0 0',
      width: '30px',
      border: range.highlight ? '2px solid #B71C1C' : '1px solid #333'
    });

    var label = ui.Label(range.icon + ' ' + range.label, {
      margin: '0',
      fontSize: '13px',
      color: '#333',
      fontWeight: range.highlight ? 'bold' : 'normal'
    });

    var row = ui.Panel({
      widgets: [colorBox, label],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '5px 0'}
    });

    legend.add(row);
  });

  // Separador
  legend.add(ui.Label('────────────────', {
    color: '#bdc3c7',
    margin: '10px 0',
    fontSize: '10px'
  }));

  // Seção Raster
  legend.add(ui.Label('Raster (Probabilidade):', {
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#2c3e50',
    margin: '5px 0 8px 0'
  }));

  // Barra de gradiente para raster
  var gradientColors = CONFIG.probabilityPalette;
  var gradientPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '5px 0'}
  });

  gradientColors.forEach(function(color) {
    gradientPanel.add(ui.Label('', {
      backgroundColor: color,
      padding: '15px 8px',
      margin: '0'
    }));
  });

  legend.add(gradientPanel);

  // Labels de min/max
  var minMaxPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '2px 0'}
  });

  minMaxPanel.add(ui.Label('0%', {
    fontSize: '11px',
    color: '#555',
    margin: '0 10px 0 0',
    stretch: 'horizontal',
    textAlign: 'left'
  }));

  minMaxPanel.add(ui.Label('100%', {
    fontSize: '11px',
    color: '#555',
    stretch: 'horizontal',
    textAlign: 'right'
  }));

  legend.add(minMaxPanel);

  return legend;
}

/**
 * Cria header principal no topo do app (acima de tudo)
 */
function createMainHeader() {
  var mainHeader = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      backgroundColor: '#0f1419',  // Azul muito escuro, quase preto
      padding: '15px 30px',
      stretch: 'horizontal',
      border: '3px solid #1e3a5f'
    }
  });

  var titleLabel = ui.Label('🌍 Análise de Probabilidade de Lixões - Sistema de Monitoramento Espacial', {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#FFFFFF',
    stretch: 'horizontal',
    textAlign: 'center',
    fontFamily: 'Roboto, Arial, sans-serif'
  });

  mainHeader.add(titleLabel);
  return mainHeader;
}

/**
 * Cria footer com logos de apoiadores
 */
function createFooter() {
  var footer = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      backgroundColor: '#f8f9fa',
      padding: '15px 20px',
      margin: '15px 0 0 0',
      border: '2px solid #dee2e6',
      stretch: 'horizontal'
    }
  });

  // Título da seção
  var footerTitle = ui.Label('Apoiadores e Parceiros', {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#2c3e50',
    margin: '0 0 10px 0',
    textAlign: 'center',
    stretch: 'horizontal'
  });

  // Container para logos
  var logoContainer = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      stretch: 'horizontal',
      padding: '10px',
      backgroundColor: '#ffffff',
      border: '1px solid #e0e0e0'
    }
  });

  // Placeholders para logos (substitua com assets reais no GEE)
  var logos = [
    {name: 'Instituição 1', url: 'https://via.placeholder.com/120x60/2980b9/ffffff?text=Logo+1'},
    {name: 'Instituição 2', url: 'https://via.placeholder.com/120x60/27ae60/ffffff?text=Logo+2'},
    {name: 'Instituição 3', url: 'https://via.placeholder.com/120x60/e74c3c/ffffff?text=Logo+3'}
  ];

  // Adicionar texto explicativo sobre como adicionar logos reais
  var instructionLabel = ui.Label(
    '💡 Para adicionar logos reais: carregue as imagens como assets no GEE e use ee.Image(asset_path)',
    {
      fontSize: '11px',
      color: '#7f8c8d',
      fontStyle: 'italic',
      margin: '5px 0',
      whiteSpace: 'pre'
    }
  );

  // Label de placeholder para logos
  var logoPlaceholder = ui.Label('📋 [Logos dos Apoiadores: CNPq | FAPESP | CAPES | Universidades]', {
    fontSize: '13px',
    color: '#34495e',
    fontWeight: 'bold',
    textAlign: 'center',
    stretch: 'horizontal',
    margin: '5px'
  });

  footer.add(footerTitle);
  logoContainer.add(logoPlaceholder);
  footer.add(logoContainer);
  footer.add(instructionLabel);

  return footer;
}

// ===========================
// ATUALIZAÇÃO E VISUALIZAÇÃO
// ===========================

/**
 * Cria indicador de carregamento
 */
function createLoadingIndicator() {
  return ui.Panel({
    widgets: [
      ui.Label({
        value: '⏳ Processando...',
        style: {
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#2980b9',
          padding: '10px',
          backgroundColor: '#e8f4f8',
          border: '2px solid #3498db'
        }
      })
    ],
    style: {
      position: 'top-center',
      padding: '0px'
    }
  });
}

/**
 * Atualiza visualização com base nos filtros
 */
function updateVisualization() {
  // Mostrar indicador de carregamento
  var loadingPanel = createLoadingIndicator();
  mapPanel.add(loadingPanel);

  // Limpar camadas anteriores (exceto loading)
  var layers = mapPanel.layers();
  while (layers.length() > 0) {
    layers.remove(layers.get(0));
  }

  // Usar métrica de probabilidade padrão (primeira disponível)
  var metric = probColumns[0];
  var state = filters.stateSelect.getValue();
  var muni = filters.muniSelect.getValue();
  
  // Filtrar dados vetoriais
  var filteredVector = vectorData;
  
  if (state !== 'Todos') {
    filteredVector = filteredVector.filter(ee.Filter.eq('uf', state));
  }
  
  if (muni !== 'Todos' && muni !== null) {
    filteredVector = filteredVector.filter(ee.Filter.eq('muni_name', muni));
  }
  
  // Aplicar estilo
  var styledVector = styleVector(filteredVector, metric);

  // Adicionar camadas ao mapa
  // Raster com opacidade ajustada para basemap híbrido
  mapPanel.addLayer(rasterData.select('prob_class0'), {
    min: 0,
    max: 1,
    palette: CONFIG.probabilityPalette
  }, 'Probabilidade Raster', true, 0.6);  // Opacidade reduzida para melhor visualização com basemap

  // Polígonos vetoriais com destaque
  mapPanel.addLayer(
    styledVector.style({styleProperty: 'style'}),
    {},
    'Polígonos - Áreas Identificadas',
    true
  );
  
  // Centralizar no filtro se específico
  if (muni !== 'Todos' && muni !== null) {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 12);
  } else if (state !== 'Todos') {
    var bounds = filteredVector.geometry().bounds();
    mapPanel.centerObject(bounds, 7);
  }
  
  // Atualizar métricas
  updateMetrics(filteredVector, metric);

  // Remover indicador de carregamento
  mapPanel.remove(loadingPanel);

  // Adicionar legenda novamente (foi removida com as layers)
  mapPanel.add(createLegend());

  // Configurar clique para popup com informações detalhadas
  mapPanel.onClick(function(coords) {
    var point = ee.Geometry.Point(coords.lon, coords.lat);
    var clicked = styledVector.filterBounds(point);

    clicked.evaluate(function(features) {
      if (features.features.length > 0) {
        var feat = features.features[0];
        var props = feat.properties;

        var prob = props[metric] * 100;
        var probText = prob.toFixed(1).replace('.', ',') + '%';

        // Determinar a faixa de probabilidade
        var faixa = '';
        var corIcon = '';
        if (prob < 75) {
          faixa = 'Baixa';
          corIcon = '🟢';
        } else if (prob < 89) {
          faixa = 'Média';
          corIcon = '🟠';
        } else {
          faixa = 'Alta';
          corIcon = '🔴';
        }

        // Determinar cor de fundo baseada na faixa
        var bgColor = '#e8f5e9';  // Verde claro
        if (faixa === 'Média') bgColor = '#fff3e0';  // Laranja claro
        if (faixa === 'Alta') bgColor = '#ffebee';   // Vermelho claro

        var infoPanel = ui.Panel({
          widgets: [
            ui.Label('📍 Informações da Área', {
              fontWeight: 'bold',
              fontSize: '15px',
              color: '#1a252f',
              margin: '0 0 10px 0'
            }),
            ui.Label('Estado: ' + props.uf, {
              fontSize: '13px',
              color: '#2c3e50',
              fontWeight: 'bold',
              margin: '4px 0'
            }),
            ui.Label('Município: ' + props.muni_name, {
              fontSize: '13px',
              color: '#34495e',
              margin: '4px 0'
            }),
            ui.Label('─────────────────', {
              fontSize: '10px',
              color: '#bdc3c7',
              margin: '8px 0'
            }),
            ui.Label(corIcon + ' Probabilidade: ' + probText, {
              fontSize: '14px',
              color: '#1a252f',
              fontWeight: 'bold',
              margin: '4px 0'
            }),
            ui.Label('Categoria: ' + faixa, {
              fontSize: '13px',
              color: faixa === 'Alta' ? '#c0392b' : (faixa === 'Média' ? '#d68910' : '#27ae60'),
              fontWeight: 'bold',
              margin: '4px 0'
            }),
            ui.Label('💡 Clique fora para fechar', {
              fontSize: '11px',
              color: '#7f8c8d',
              fontStyle: 'italic',
              margin: '8px 0 0 0'
            })
          ],
          style: {
            position: 'bottom-left',
            backgroundColor: bgColor,
            padding: '18px',
            border: '3px solid #2c3e50',
            maxWidth: '300px'
          }
        });

        mapPanel.add(infoPanel);
      }
    });
  });
}

/**
 * Atualiza painel de métricas
 */
function updateMetrics(features, probColumn) {
  var count = features.size();
  var avgProb = features.aggregate_mean(probColumn);
  
  // Atualizar labels básicos
  metrics.totalLabel.setValue('Total de ocorrências: ' + count.getInfo());
  metrics.avgProbLabel.setValue('Probabilidade média: ' + 
    (avgProb.getInfo() * 100).toFixed(1).replace('.', ',') + '%');
  
  // Calcular por faixa
  var rangeStats = calculateStatsByRange(features, probColumn);
  metrics.lowLabel.setValue('🟢 Baixa (0-75%): ' + rangeStats.baixa);
  metrics.medLabel.setValue('🟠 Média (75-89%): ' + rangeStats.media);
  metrics.highLabel.setValue('🔴 Alta (89-100%): ' + rangeStats.alta);
}

// ===========================
// INICIALIZAÇÃO
// ===========================

// Carregar dados
print('Carregando dados...');
var rasterData = loadRasterData();
var vectorData = loadVectorData();

// Detectar colunas disponíveis
var probColumns = detectProbabilityColumns(vectorData);

if (probColumns.length === 0) {
  print('ERRO: Nenhuma coluna de probabilidade encontrada (prob_media, prob_mean, prob_max)');
  print('Verifique os dados vetoriais');
} else {
  print('Colunas de probabilidade disponíveis:', probColumns);
  
  // Construir interface com novo layout

  // Criar painel principal com layout vertical para incluir header
  var appContainer = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {
      width: '100%',
      height: '100%',
      padding: '0px',
      margin: '0px'
    }
  });

  // Adicionar header principal no topo
  appContainer.add(createMainHeader());

  // Construir sidebar
  sidePanel.add(createHeader());

  // Adicionar painel de informações técnicas
  sidePanel.add(createInfoPanel());

  var filterSection = createFilterSection(vectorData, probColumns);
  var filters = filterSection;
  sidePanel.add(filterSection.panel);

  var metricsSection = createMetricsPanel();
  var metrics = metricsSection;
  sidePanel.add(metricsSection.panel);

  // Adicionar footer ao sidebar
  sidePanel.add(createFooter());

  // Adicionar legenda ao mapa
  mapPanel.add(createLegend());

  // Montar layout principal (sidebar + mapa)
  mainPanel.add(sidePanel);
  mainPanel.add(mapPanel);

  // Adicionar ao container
  appContainer.add(mainPanel);

  // Limpar root e adicionar container completo
  ui.root.clear();
  ui.root.add(appContainer);
  
  // Carregar visualização inicial
  updateVisualization();
  
  // Exemplo de como adicionar logos (substitua com URLs reais dos assets)
  // addLogos(['users/seu_usuario/logo1', 'users/seu_usuario/logo2']);
}

import React, { useState, useEffect, useCallback } from 'react';
import type { MappingConfig, FieldInfo, ZoneConfig, GeoIPConfig, ViewMode } from './types';
import { getMapping, updateMapping, getFields, clearFields, previewTemplate, getConfig, updateConfig, detectLocation } from './api';
import { useTranslation } from './i18n';

const VERSION = '1.5.0';

// Chevron icon for collapsible sections
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`section-toggle-icon ${expanded ? 'expanded' : ''}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface Props {
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export function SettingsPanel({ open, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [mapping, setMapping] = useState<MappingConfig | null>(null);
  const [zones, setZones] = useState<ZoneConfig | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [nodePreview, setNodePreview] = useState('');
  const [edgePreview, setEdgePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [internalCidrsText, setInternalCidrsText] = useState('');
  const [internalFilterIpsText, setInternalFilterIpsText] = useState('');
  const [internalFilterApplyTo, setInternalFilterApplyTo] = useState<string[]>(['flow']);
  const [minTrafficThreshold, setMinTrafficThreshold] = useState(0);
  const [topNInternal, setTopNInternal] = useState(0);
  const [topNInternalApplyTo, setTopNInternalApplyTo] = useState<string[]>(['flow']);
  const [topNExternal, setTopNExternal] = useState(0);
  const [topNExternalApplyTo, setTopNExternalApplyTo] = useState<string[]>(['flow']);
  const [showInternalTraffic, setShowInternalTraffic] = useState(false);
  const [showTrafficValue, setShowTrafficValue] = useState(false);
  const [flowTtlSeconds, setFlowTtlSeconds] = useState(5);
  // GeoIP settings
  const [geoipSourceField, setGeoipSourceField] = useState('source_ip_geolocation');
  const [geoipDestField, setGeoipDestField] = useState('destination_ip_geolocation');
  const [hideNoGeo, setHideNoGeo] = useState(true);
  const [internalFallbackLat, setInternalFallbackLat] = useState(0);
  const [internalFallbackLng, setInternalFallbackLng] = useState(0);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [detectedLocationInfo, setDetectedLocationInfo] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mapBrightness, setMapBrightness] = useState(30);
  const [showStarfield, setShowStarfield] = useState(true);
  const [statsTopN, setStatsTopN] = useState(15);
  const [focusZoomLevel, setFocusZoomLevel] = useState(14);
  const [defaultView, setDefaultView] = useState<ViewMode>('flow');
  const [transitionEffect, setTransitionEffect] = useState<'warp' | 'matrix'>('warp');

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    zone: true,
    geoip: false,
    fieldMapping: false,
    valueField: false,
    labelTemplates: false,
    discoveredFields: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Filter and sort fields for display
  const filteredFields = fields
    .filter(f => !f.name.startsWith('_') && !f.name.startsWith('gl2_'))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Load initial data
  useEffect(() => {
    if (open) {
      getMapping().then(setMapping);
      getFields().then(data => setFields(data.fields));
      getConfig().then(config => {
        setZones(config.zones);
        setInternalCidrsText(config.zones.internal_cidrs.join('\n'));
        setInternalFilterIpsText(config.zones.internal_filter_ips?.join('\n') || '');
        setInternalFilterApplyTo(config.zones.internal_filter_apply_to || ['flow']);
        setMinTrafficThreshold(config.zones.min_traffic_threshold || 0);
        setTopNInternal(config.zones.top_n_internal || 0);
        setTopNInternalApplyTo(config.zones.top_n_internal_apply_to || ['flow']);
        setTopNExternal(config.zones.top_n_external || 0);
        setTopNExternalApplyTo(config.zones.top_n_external_apply_to || ['flow']);
        setShowInternalTraffic(config.zones.show_internal_traffic ?? false);
        setShowTrafficValue(config.zones.show_traffic_value ?? false);
        setFlowTtlSeconds(config.flow_ttl_seconds || 5);
        setDefaultView(config.default_view || 'flow');
        setTransitionEffect((config.transition_effect as 'warp' | 'matrix') || 'warp');
        // Load GeoIP settings
        if (config.geoip) {
          setGeoipSourceField(config.geoip.source_field || 'source_ip_geolocation');
          setGeoipDestField(config.geoip.destination_field || 'destination_ip_geolocation');
          setHideNoGeo(config.geoip.hide_no_geo ?? true);
          const lat = config.geoip.internal_fallback_lat || 0;
          const lng = config.geoip.internal_fallback_lng || 0;
          setInternalFallbackLat(lat);
          setInternalFallbackLng(lng);
          setMapBrightness(config.geoip.map_brightness ?? 30);
          setShowStarfield(config.geoip.show_starfield ?? true);
          setStatsTopN(config.geoip.stats_top_n ?? 15);
          setFocusZoomLevel(config.geoip.focus_zoom_level ?? 14);
          // Auto-detect location if not set
          if (lat === 0 && lng === 0) {
            detectLocation().then(result => {
              if (result.success && result.lat !== undefined && result.lng !== undefined) {
                setInternalFallbackLat(result.lat);
                setInternalFallbackLng(result.lng);
                setDetectedLocationInfo(`${result.city}, ${result.country} (${result.ip})`);
              }
            }).catch(() => {});
          }
        }
      });
    }
  }, [open]);

  // Preview templates
  const updatePreviews = useCallback(async (m: MappingConfig) => {
    const [nodeRes, edgeRes] = await Promise.all([
      previewTemplate(m.node_label_template),
      previewTemplate(m.edge_label_template),
    ]);
    setNodePreview(nodeRes.error || nodeRes.result);
    setEdgePreview(edgeRes.error || edgeRes.result);
  }, []);

  useEffect(() => {
    if (mapping) {
      updatePreviews(mapping);
    }
  }, [mapping, updatePreviews]);

  // Refresh fields periodically
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      getFields().then(data => setFields(data.fields));
    }, 5000);
    return () => clearInterval(interval);
  }, [open]);

  // Handle open/close animation
  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 300); // Match the animation duration
      return () => clearTimeout(timer);
    }
  }, [open, shouldRender]);

  const handleChange = (key: keyof MappingConfig, value: string | number) => {
    if (!mapping) return;
    setMapping({ ...mapping, [key]: value });
  };

  const handleSave = async () => {
    if (!mapping) return;
    setSaving(true);
    try {
      const updated = await updateMapping(mapping);
      setMapping(updated);

      // Save zones config
      const internalCidrs = internalCidrsText
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const internalFilterIps = internalFilterIpsText
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      await updateConfig({
        flow_ttl_seconds: flowTtlSeconds,
        default_view: defaultView,
        transition_effect: transitionEffect,
        zones: {
          internal_cidrs: internalCidrs,
          external_cidrs: [],
          internal_filter_ips: internalFilterIps,
          internal_filter_apply_to: internalFilterApplyTo,
          min_traffic_threshold: minTrafficThreshold,
          top_n_internal: topNInternal,
          top_n_internal_apply_to: topNInternalApplyTo,
          top_n_external: topNExternal,
          top_n_external_apply_to: topNExternalApplyTo,
          show_internal_traffic: showInternalTraffic,
          show_traffic_value: showTrafficValue,
        },
        geoip: {
          source_field: geoipSourceField,
          destination_field: geoipDestField,
          hide_no_geo: hideNoGeo,
          internal_fallback_lat: internalFallbackLat,
          internal_fallback_lng: internalFallbackLng,
          auto_detect_location: false,
          map_brightness: mapBrightness,
          show_starfield: showStarfield,
          stats_top_n: statsTopN,
          focus_zoom_level: focusZoomLevel,
        }
      });
      // Notify parent to reload config
      onSave?.();
      // Show success message
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleAutoDetectLocation = async () => {
    setDetectingLocation(true);
    setDetectedLocationInfo('');
    try {
      const result = await detectLocation();
      if (result.success && result.lat !== undefined && result.lng !== undefined) {
        setInternalFallbackLat(result.lat);
        setInternalFallbackLng(result.lng);
        setDetectedLocationInfo(`${result.city}, ${result.country} (${result.ip})`);
      } else {
        setDetectedLocationInfo(`Error: ${result.error || 'Unknown error'}`);
      }
    } catch (e) {
      setDetectedLocationInfo(`Error: ${e}`);
    } finally {
      setDetectingLocation(false);
    }
  };

  if (!shouldRender) return null;

  return (
    <div className={`settings-panel ${isClosing ? 'closing' : ''}`}>
      <div className="settings-header">
        <h2>{t('settings.title')}</h2>
        <button className="settings-close" onClick={onClose}>×</button>
      </div>

      <div className="settings-content">
        {mapping && (
          <>
            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('zone')}>
                <h3>{t('settings.zoneSettings')}</h3>
                <ChevronIcon expanded={expandedSections.zone} />
              </div>
              {expandedSections.zone && (
              <div className="section-content">
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('settings.internalCidrs')}</label>
                  <button
                    className="btn-small"
                    onClick={() => setInternalCidrsText('192.168.0.0/16\n10.0.0.0/8\n172.16.0.0/12')}
                    title="Set RFC1918 private network defaults"
                  >
                    Defaults
                  </button>
                </div>
                <textarea
                  value={internalCidrsText}
                  onChange={e => setInternalCidrsText(e.target.value)}
                  placeholder="192.168.0.0/16&#10;10.0.0.0/8&#10;172.16.0.0/12"
                  rows={3}
                />
                <div className="hint">
                  {t('settings.internalCidrsHint')}
                </div>
              </div>
              <div className="form-group textarea-with-apply">
                <label>{t('settings.internalFilterIps')}</label>
                <textarea
                  value={internalFilterIpsText}
                  onChange={e => setInternalFilterIpsText(e.target.value)}
                  placeholder="192.168.1.1&#10;192.168.1.100&#10;192.168.1.200"
                  rows={4}
                />
                <div className="apply-to-row">
                  <span className="apply-to-label">{t('settings.internalFilterApplyTo')}</span>
                  <div className="apply-to-buttons">
                    <button
                      type="button"
                      className={`apply-to-btn ${internalFilterApplyTo.includes('flow') ? 'active' : ''}`}
                      onClick={() => setInternalFilterApplyTo(prev => prev.includes('flow') ? prev.filter(v => v !== 'flow') : [...prev, 'flow'])}
                    >{t('view.flow')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${internalFilterApplyTo.includes('2d-geo') ? 'active' : ''}`}
                      onClick={() => setInternalFilterApplyTo(prev => prev.includes('2d-geo') ? prev.filter(v => v !== '2d-geo') : [...prev, '2d-geo'])}
                    >{t('view.2dMap')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${internalFilterApplyTo.includes('3d-globe') ? 'active' : ''}`}
                      onClick={() => setInternalFilterApplyTo(prev => prev.includes('3d-globe') ? prev.filter(v => v !== '3d-globe') : [...prev, '3d-globe'])}
                    >{t('view.3dGlobe')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${internalFilterApplyTo.includes('sankey') ? 'active' : ''}`}
                      onClick={() => setInternalFilterApplyTo(prev => prev.includes('sankey') ? prev.filter(v => v !== 'sankey') : [...prev, 'sankey'])}
                    >{t('view.sankey')}</button>
                  </div>
                </div>
                <div className="hint">
                  {t('settings.internalFilterIpsHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.flowTtl')}</label>
                <input
                  type="number"
                  value={flowTtlSeconds}
                  onChange={e => setFlowTtlSeconds(parseFloat(e.target.value) || 5)}
                  min={1}
                  step={0.5}
                />
                <div className="hint">
                  {t('settings.flowTtlHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.defaultView')}</label>
                <select
                  value={defaultView}
                  onChange={e => setDefaultView(e.target.value as ViewMode)}
                >
                  <option value="flow">{t('view.flow')}</option>
                  <option value="2d-geo">{t('view.2dMap')}</option>
                  <option value="3d-globe">{t('view.3dGlobe')}</option>
                  <option value="sankey">{t('view.sankey')}</option>
                </select>
                <div className="hint">
                  {t('settings.defaultViewHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.transitionEffect')}</label>
                <select
                  value={transitionEffect}
                  onChange={e => setTransitionEffect(e.target.value as 'warp' | 'matrix')}
                >
                  <option value="warp">{t('settings.transitionEffect.warp')}</option>
                  <option value="matrix">{t('settings.transitionEffect.matrix')}</option>
                </select>
                <div className="hint">
                  {t('settings.transitionEffectHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.minTraffic')}</label>
                <input
                  type="number"
                  value={minTrafficThreshold}
                  onChange={e => setMinTrafficThreshold(parseInt(e.target.value) || 0)}
                  min={0}
                />
                <div className="hint">
                  {t('settings.minTrafficHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.topNInternal')}</label>
                <div className="input-with-apply">
                  <input
                    type="number"
                    value={topNInternal}
                    onChange={e => setTopNInternal(parseInt(e.target.value) || 0)}
                    min={0}
                  />
                  <div className="apply-to-buttons">
                    <button
                      type="button"
                      className={`apply-to-btn ${topNInternalApplyTo.includes('flow') ? 'active' : ''}`}
                      onClick={() => setTopNInternalApplyTo(prev => prev.includes('flow') ? prev.filter(v => v !== 'flow') : [...prev, 'flow'])}
                    >{t('view.flow')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNInternalApplyTo.includes('2d-geo') ? 'active' : ''}`}
                      onClick={() => setTopNInternalApplyTo(prev => prev.includes('2d-geo') ? prev.filter(v => v !== '2d-geo') : [...prev, '2d-geo'])}
                    >{t('view.2dMap')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNInternalApplyTo.includes('3d-globe') ? 'active' : ''}`}
                      onClick={() => setTopNInternalApplyTo(prev => prev.includes('3d-globe') ? prev.filter(v => v !== '3d-globe') : [...prev, '3d-globe'])}
                    >{t('view.3dGlobe')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNInternalApplyTo.includes('sankey') ? 'active' : ''}`}
                      onClick={() => setTopNInternalApplyTo(prev => prev.includes('sankey') ? prev.filter(v => v !== 'sankey') : [...prev, 'sankey'])}
                    >{t('view.sankey')}</button>
                  </div>
                </div>
                <div className="hint">
                  {t('settings.topNInternalHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.topNExternal')}</label>
                <div className="input-with-apply">
                  <input
                    type="number"
                    value={topNExternal}
                    onChange={e => setTopNExternal(parseInt(e.target.value) || 0)}
                    min={0}
                  />
                  <div className="apply-to-buttons">
                    <button
                      type="button"
                      className={`apply-to-btn ${topNExternalApplyTo.includes('flow') ? 'active' : ''}`}
                      onClick={() => setTopNExternalApplyTo(prev => prev.includes('flow') ? prev.filter(v => v !== 'flow') : [...prev, 'flow'])}
                    >{t('view.flow')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNExternalApplyTo.includes('2d-geo') ? 'active' : ''}`}
                      onClick={() => setTopNExternalApplyTo(prev => prev.includes('2d-geo') ? prev.filter(v => v !== '2d-geo') : [...prev, '2d-geo'])}
                    >{t('view.2dMap')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNExternalApplyTo.includes('3d-globe') ? 'active' : ''}`}
                      onClick={() => setTopNExternalApplyTo(prev => prev.includes('3d-globe') ? prev.filter(v => v !== '3d-globe') : [...prev, '3d-globe'])}
                    >{t('view.3dGlobe')}</button>
                    <button
                      type="button"
                      className={`apply-to-btn ${topNExternalApplyTo.includes('sankey') ? 'active' : ''}`}
                      onClick={() => setTopNExternalApplyTo(prev => prev.includes('sankey') ? prev.filter(v => v !== 'sankey') : [...prev, 'sankey'])}
                    >{t('view.sankey')}</button>
                  </div>
                </div>
                <div className="hint">
                  {t('settings.topNExternalHint')}
                </div>
              </div>
              <div className="form-group">
                <label>{t('settings.statsTopN')}</label>
                <select
                  value={statsTopN}
                  onChange={e => setStatsTopN(parseInt(e.target.value))}
                >
                  <option value="10">Top 10</option>
                  <option value="15">Top 15</option>
                  <option value="20">Top 20</option>
                  <option value="30">Top 30</option>
                  <option value="50">Top 50</option>
                </select>
                <div className="hint">
                  {t('settings.statsTopNHint')}
                </div>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showInternalTraffic}
                    onChange={e => setShowInternalTraffic(e.target.checked)}
                  />
                  {t('settings.showInternalTraffic')}
                </label>
                <div className="hint">
                  {t('settings.showInternalTrafficHint')}
                </div>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showTrafficValue}
                    onChange={e => setShowTrafficValue(e.target.checked)}
                  />
                  {t('settings.showTrafficValue')}
                </label>
                <div className="hint">
                  {t('settings.showTrafficValueHint')}
                </div>
              </div>
              </div>
              )}
            </div>

            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('geoip')}>
                <h3>{t('settings.geoipSettings')}</h3>
                <ChevronIcon expanded={expandedSections.geoip} />
              </div>
              {expandedSections.geoip && (
              <div className="section-content">

              <div className="form-group">
                <label>{t('settings.sourceGeoField')}</label>
                <input
                  type="text"
                  value={geoipSourceField}
                  onChange={e => setGeoipSourceField(e.target.value)}
                  placeholder="source_ip_geolocation"
                />
                <div className="hint">
                  {t('settings.sourceGeoFieldHint')}
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.destGeoField')}</label>
                <input
                  type="text"
                  value={geoipDestField}
                  onChange={e => setGeoipDestField(e.target.value)}
                  placeholder="destination_ip_geolocation"
                />
                <div className="hint">
                  {t('settings.destGeoFieldHint')}
                </div>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={hideNoGeo}
                    onChange={e => setHideNoGeo(e.target.checked)}
                  />
                  {t('settings.hideNoGeo')}
                </label>
                <div className="hint">
                  {t('settings.hideNoGeoHint')}
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('settings.internalLocation')}</label>
                  <button
                    className="btn-small"
                    onClick={handleAutoDetectLocation}
                    disabled={detectingLocation}
                    title={t('btn.autoDetect')}
                  >
                    {detectingLocation ? t('btn.detecting') : t('btn.autoDetect')}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <input
                      type="number"
                      value={internalFallbackLat}
                      onChange={e => setInternalFallbackLat(parseFloat(e.target.value) || 0)}
                      placeholder={t('settings.latitude')}
                      step="0.0001"
                    />
                    <div className="hint">{t('settings.latitude')} (-90 to 90)</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <input
                      type="number"
                      value={internalFallbackLng}
                      onChange={e => setInternalFallbackLng(parseFloat(e.target.value) || 0)}
                      placeholder={t('settings.longitude')}
                      step="0.0001"
                    />
                    <div className="hint">{t('settings.longitude')} (-180 to 180)</div>
                  </div>
                </div>
                {detectedLocationInfo && (
                  <div className="hint" style={{ color: detectedLocationInfo.startsWith('Error') ? '#ff6b6b' : '#00d4ff' }}>
                    {detectedLocationInfo}
                  </div>
                )}
                <div className="hint">
                  {t('settings.internalLocationHint')}
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.mapBrightness')}: {mapBrightness}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={mapBrightness}
                  onChange={e => setMapBrightness(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div className="hint">{t('settings.mapBrightnessHint')}</div>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showStarfield}
                    onChange={e => setShowStarfield(e.target.checked)}
                  />
                  {t('settings.showStarfield')}
                </label>
                <div className="hint">{t('settings.showStarfieldHint')}</div>
              </div>

              <div className="form-group">
                <label>{t('settings.focusZoomLevel')}: {focusZoomLevel}x</label>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={focusZoomLevel}
                  onChange={e => setFocusZoomLevel(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div className="hint">{t('settings.focusZoomLevelHint')}</div>
              </div>

              </div>
              )}
            </div>

            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('fieldMapping')}>
                <h3>{t('settings.fieldMapping')}</h3>
                <ChevronIcon expanded={expandedSections.fieldMapping} />
              </div>
              {expandedSections.fieldMapping && (
              <div className="section-content">

              <div className="hint" style={{ marginBottom: 10 }}>
                {t('settings.fieldMappingHint')}
              </div>

              <div className="form-group">
                <label>{t('settings.sourceIpField')}</label>
                <div className="field-mapping-row">
                  <input
                    type="text"
                    value={mapping.src_field}
                    onChange={e => handleChange('src_field', e.target.value)}
                    placeholder="e.g., src_ip"
                  />
                  <input
                    type="text"
                    value={mapping.src_field_display || ''}
                    onChange={e => handleChange('src_field_display', e.target.value)}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.destIpField')}</label>
                <div className="field-mapping-row">
                  <input
                    type="text"
                    value={mapping.dst_field}
                    onChange={e => handleChange('dst_field', e.target.value)}
                    placeholder="e.g., dst_ip"
                  />
                  <input
                    type="text"
                    value={mapping.dst_field_display || ''}
                    onChange={e => handleChange('dst_field_display', e.target.value)}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.protoField')}</label>
                <div className="field-mapping-row">
                  <input
                    type="text"
                    value={mapping.proto_field}
                    onChange={e => handleChange('proto_field', e.target.value)}
                    placeholder="e.g., proto"
                  />
                  <input
                    type="text"
                    value={mapping.proto_field_display || ''}
                    onChange={e => handleChange('proto_field_display', e.target.value)}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.srcPtrField')}</label>
                <div className="field-mapping-row">
                  <input
                    type="text"
                    value={mapping.src_ptr_field || ''}
                    onChange={e => handleChange('src_ptr_field', e.target.value)}
                    placeholder="source_ip_ptr"
                  />
                  <input
                    type="text"
                    value={mapping.src_ptr_field_display || ''}
                    onChange={e => handleChange('src_ptr_field_display', e.target.value)}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.dstPtrField')}</label>
                <div className="field-mapping-row">
                  <input
                    type="text"
                    value={mapping.dst_ptr_field || ''}
                    onChange={e => handleChange('dst_ptr_field', e.target.value)}
                    placeholder="destination_ip_ptr"
                  />
                  <input
                    type="text"
                    value={mapping.dst_ptr_field_display || ''}
                    onChange={e => handleChange('dst_ptr_field_display', e.target.value)}
                    placeholder={t('settings.displayNamePlaceholder')}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.countryDisplayLabel')}</label>
                <input
                  type="text"
                  value={mapping.country_display || ''}
                  onChange={e => handleChange('country_display', e.target.value)}
                  placeholder="Source Country"
                />
                <div className="hint">{t('settings.countryDisplayHint')}</div>
              </div>
              </div>
              )}
            </div>

            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('valueField')}>
                <h3>{t('settings.valueField')}</h3>
                <ChevronIcon expanded={expandedSections.valueField} />
              </div>
              {expandedSections.valueField && (
              <div className="section-content">

              <div className="form-group">
                <label>{t('settings.valueField')}</label>
                <input
                  type="text"
                  value={mapping.value_field}
                  onChange={e => handleChange('value_field', e.target.value)}
                  placeholder="e.g., bytes"
                />
              </div>

              <div className="form-group">
                <label>{t('settings.valueDefault')}</label>
                <input
                  type="number"
                  value={mapping.value_default}
                  onChange={e => handleChange('value_default', parseFloat(e.target.value) || 1)}
                />
              </div>

              <div className="form-group">
                <label>{t('settings.valueTransform')}</label>
                <select
                  value={mapping.value_transform}
                  onChange={e => handleChange('value_transform', e.target.value as 'none' | 'log' | 'sqrt')}
                >
                  <option value="none">{t('settings.transformNone')}</option>
                  <option value="log">{t('settings.transformLog')}</option>
                  <option value="sqrt">{t('settings.transformSqrt')}</option>
                </select>
                <div className="hint">{t('settings.transformHint')}</div>
              </div>
              </div>
              )}
            </div>

            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('labelTemplates')}>
                <h3>{t('settings.labelTemplates')}</h3>
                <ChevronIcon expanded={expandedSections.labelTemplates} />
              </div>
              {expandedSections.labelTemplates && (
              <div className="section-content">
              <div className="hint" style={{ marginBottom: 12 }}>
                {t('settings.templateHint')}
              </div>

              <div className="form-group">
                <label>{t('settings.nodeLabelTemplate')}</label>
                <textarea
                  value={mapping.node_label_template}
                  onChange={e => handleChange('node_label_template', e.target.value)}
                  placeholder="{src_ip}"
                />
                <div className="template-preview-label">{t('settings.preview')}</div>
                <div className={`template-preview ${nodePreview.startsWith('Error') ? 'error' : ''}`}>
                  {nodePreview || t('settings.noData')}
                </div>
              </div>

              <div className="form-group">
                <label>{t('settings.edgeLabelTemplate')}</label>
                <textarea
                  value={mapping.edge_label_template}
                  onChange={e => handleChange('edge_label_template', e.target.value)}
                  placeholder="{proto|tcp}:{dst_port|0}"
                />
                <div className="template-preview-label">{t('settings.preview')}</div>
                <div className={`template-preview ${edgePreview.startsWith('Error') ? 'error' : ''}`}>
                  {edgePreview || t('settings.noData')}
                </div>
              </div>
              </div>
              )}
            </div>

            <div className="settings-section">
              <div className="section-header" onClick={() => toggleSection('discoveredFields')}>
                <h3 style={{ margin: 0 }}>{t('settings.discoveredFields')} ({filteredFields.length})</h3>
                <ChevronIcon expanded={expandedSections.discoveredFields} />
              </div>
              {expandedSections.discoveredFields && (
              <div className="section-content">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  className="btn btn-small"
                  onClick={async () => {
                    await clearFields();
                    setFields([]);
                  }}
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  title={t('settings.clearFieldsTooltip')}
                >
                  {t('settings.clearFields')}
                </button>
              </div>
              <div className="fields-table-container">
                <table className="fields-table">
                  <thead>
                    <tr>
                      <th>{t('settings.fieldName')}</th>
                      <th>{t('settings.fieldType')}</th>
                      <th>{t('settings.fieldCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFields.map(f => (
                      <tr key={f.name}>
                        <td className="field-name">{f.name}</td>
                        <td>{f.inferredType}</td>
                        <td>{f.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </div>
              )}
            </div>

            <button
              className="btn btn-save"
              onClick={handleSave}
              disabled={saving}
              style={{ width: '100%' }}
            >
              {saving ? t('btn.saving') : t('btn.save')}
            </button>

            {saveSuccess && (
              <div className="save-success-message">
                {t('btn.saveSuccess')}
              </div>
            )}

            <div className="settings-footer">
              <span>by Jason Tools</span>
              <span>JT-GELFLOW v{VERSION}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

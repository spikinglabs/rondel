import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copyText } from './ui';
import { VERSION, feedbackHref } from '../lib/lab';
import { t } from '../lib/i18n';

interface State {
  error: Error | null;
  details: string;
}

/**
 * Shows a plain error screen instead of a blank page when a page fails to render, with the details
 * to copy into a feedback report. The details never include the page address, which holds the meeting key.
 * Going to another page (or Reload) clears it.
 */
export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, details: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const page = location.hash.split('/')[1] || 'home';
    const stack = (error.stack ?? '').split('\n').slice(0, 8).join('\n');
    const where = (info.componentStack ?? '').trim().split('\n').slice(0, 6).join('\n');
    this.setState({ details: `Rondel ${VERSION}, page: ${page}\n${navigator.userAgent}\n\n${error.message}\n\n${stack}\n\nIn:\n${where}` });
  }

  componentDidMount() {
    window.addEventListener('hashchange', this.clear);
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.clear);
  }

  private clear = () => this.state.error && this.setState({ error: null, details: '' });

  render() {
    if (!this.state.error) return this.props.children;
    const feedback = feedbackHref();
    const [before, after] = t('Please {link} and paste these details, which contain no meeting content or link:').split('{link}');
    return (
      <div className="page">
        <div className="card stack error-screen" role="alert">
          <h2>{t('Something went wrong on this page')}</h2>
          <p className="muted">
            {t('Nothing you wrote is lost: your meetings are kept in this browser and, for shared meetings, on the server. Reloading usually fixes it.')}
          </p>
          <div className="row wrap">
            <button className="primary" onClick={() => location.reload()}>{t('Reload')}</button>
            <a href="#/">{t('Back to my meetings')}</a>
          </div>
          <p className="small muted">
            {feedback ? <>{before}<a href={feedback} target="_blank" rel="noopener">{t('report it')}</a>{after}</> : t('If you report it, include these details, which contain no meeting content or link:')}
          </p>
          <textarea readOnly rows={8} value={this.state.details} aria-label={t('Error details')} onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <button className="sm" onClick={() => copyText(this.state.details, t('Details copied'))}>{t('Copy details')}</button>

          </div>
        </div>
      </div>
    );
  }
}

/** Throws while rendering, so the error screen can be checked on a live site: #/crash-test */
export function CrashTest(): ReactNode {
  throw new Error('Crash test: this error was triggered on purpose to check the error screen');
}

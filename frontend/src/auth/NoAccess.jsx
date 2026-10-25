import { Icon } from '../components/Icon.jsx';
import { MenuButton } from '../components/MenuButton.jsx';

/** Shown to a signed-in user who has no dashboards assigned (and is not a superuser): an empty state, not an error. */
export function NoAccess() {
  return (
    <section className="page on" id="page-noaccess">
      <div className="noaccess-bar"><MenuButton /></div>
      <div className="noaccess">
        <Icon name="shield" />
        <h2>No dashboards assigned</h2>
        <p>No dashboards assigned — contact your administrator.</p>
      </div>
    </section>
  );
}

"""State templates (app/state_templates.py): the context an Action's
state_template sees, and the sandboxed renderer it goes through."""
import pytest

from app.device import DeviceState, SensorReading
from app.state_templates import device_context, render_single_expression, template_context


def _device(**reading) -> DeviceState:
    state = DeviceState()
    state.online = True
    state.sensors = SensorReading(**reading)
    state.sensors_at = 1000.0
    return state


def test_device_context_has_the_readings_and_fahrenheit_too():
    context = device_context(_device(temperature_c=21.5, humidity=44, lux=3.5, screen="dim"), now=1012.0)
    assert context == {"temperature_c": 21.5, "temperature_f": 70.7, "humidity": 44, "lux": 3.5,
                       "screen": "dim", "online": True, "last_report_seconds": 12}


def test_device_context_before_any_report_is_all_blank():
    context = device_context(DeviceState())
    assert context["temperature_c"] is None and context["temperature_f"] is None
    assert context["online"] is False and context["last_report_seconds"] is None


def test_a_template_reads_entity_states_and_device_readings():
    context = template_context({"light.desk": {"state": "on"}}, {"temperature_c": 21.5})
    assert render_single_expression("{{ states['light.desk'].state }} {{ device.temperature_c }}", context) == \
        ("on 21.5", None)


def test_an_entity_that_isnt_there_is_an_error_naming_it():
    text, error = render_single_expression("{{ states['light.gone'].state }}", template_context({}, {}))
    assert text is None and "light.gone" in error


def test_render_single_expression_reports_errors_instead_of_raising():
    assert render_single_expression("{{ 'x' | upper }}", {}) == ("X", None)
    text, error = render_single_expression("{{ unclosed", {})
    assert text is None and error


@pytest.mark.parametrize("template", [
    "{{ ''.__class__.__mro__[1].__subclasses__() }}",
    "{{ cycler.__init__.__globals__ }}",
])
def test_templates_cannot_escape_the_sandbox(template):
    text, error = render_single_expression(template, {})
    assert text is None and error

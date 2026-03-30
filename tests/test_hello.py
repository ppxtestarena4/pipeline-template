from src.hello import greet


def test_greet_returns_greeting_with_name():
    assert greet("Alice") == "Hello, Alice!"


def test_greet_includes_name():
    result = greet("Bob")
    assert "Bob" in result


def test_greet_returns_string():
    assert isinstance(greet("Test"), str)
